'use strict';
/**
 * WF-02  Opportunity Lifecycle
 *
 * Native equivalent: "When a deal changes stage, sync the associated contacts'
 * lifecycle stage and lead status so reporting reflects commercial reality."
 *
 * Trigger : any non-sample deal
 * Actions : roll the strongest deal outcome per company down onto its contacts
 *           won -> customer / OPEN_DEAL
 *           open -> opportunity / IN_PROGRESS
 *           lost only -> lead / UNQUALIFIED
 * Idempotent: writes only where the computed value differs from the current one.
 *
 * THE BACKWARD-TRANSITION TRAP
 * HubSpot only ever moves `lifecyclestage` FORWARD. A PATCH that moves a contact
 * backwards (customer -> opportunity) returns 200 and silently does nothing —
 * no error, no warning, the old value simply stays. Because this rule reconciles,
 * it then re-detected the same drift on every single run and rewrote the same 192
 * contacts forever without ever converging.
 *
 * The fix is HubSpot's documented two-step: clear the property to '' first, then
 * set the target value. Only backward moves need it, so forward moves stay a
 * single write.
 *
 * This is the same failure mode as the association number-vs-string bug: an API
 * that reports success while doing nothing. A rule that reconciles is what made it
 * visible — a fire-once workflow would have drifted silently forever.
 */
const { searchAll, listAll, batch, readAssociations, STAGE } = require('../lib/hubspot');

// HubSpot's canonical lifecycle ordering. Index = how far down the funnel.
const LIFECYCLE_ORDER = [
  'subscriber', 'lead', 'marketingqualifiedlead', 'salesqualifiedlead',
  'opportunity', 'customer', 'evangelist', 'other',
];
const rank = s => {
  const i = LIFECYCLE_ORDER.indexOf(s);
  return i === -1 ? -1 : i;
};

module.exports = {
  id: 'WF-02',
  name: 'Opportunity Lifecycle',

  async run({ dryRun }) {
    // 1. every deal, with its company association, bucketed per company
    const deals = await searchAll('deals', {
      properties: ['dealname', 'dealstage', 'amount'],
      filterGroups: [{ filters: [{ propertyName: 'dealstage', operator: 'HAS_PROPERTY' }] }],
    });

    const dealCompanies = await readAssociations('deals', 'companies', deals.map(d => d.id));
    const byCompany = new Map();
    for (const d of deals) {
      const stage = d.properties.dealstage;
      for (const companyId of dealCompanies.get(d.id) || []) {
        const e = byCompany.get(companyId) || { won: 0, open: 0, lost: 0 };
        if (stage === STAGE.WON) e.won++;
        else if (stage === STAGE.LOST) e.lost++;
        else e.open++;
        byCompany.set(companyId, e);
      }
    }

    // 2. contacts + their company
    const contacts = await listAll('contacts', ['email', 'zia_contact_type', 'lifecyclestage', 'hs_lead_status']);
    const clients = contacts.filter(c => c.properties.zia_contact_type === 'client_contact');

    const contactCompany = await readAssociations('contacts', 'companies', clients.map(c => c.id));

    // 3. compute and diff
    const inputs = [];
    const rewind = [];          // contacts needing the clear-then-set two-step
    const dist = {};
    for (const c of clients) {
      const co = (contactCompany.get(c.id) || [])[0];
      const d = co && byCompany.get(co);
      let lifecyclestage, hs_lead_status;
      if (d && d.won > 0) { lifecyclestage = 'customer'; hs_lead_status = 'OPEN_DEAL'; }
      else if (d && d.open > 0) { lifecyclestage = 'opportunity'; hs_lead_status = 'IN_PROGRESS'; }
      else if (d && d.lost > 0) { lifecyclestage = 'lead'; hs_lead_status = 'UNQUALIFIED'; }
      else { lifecyclestage = 'lead'; hs_lead_status = 'NEW'; }

      dist[lifecyclestage] = (dist[lifecyclestage] || 0) + 1;

      const current = c.properties.lifecyclestage;
      if (current !== lifecyclestage || c.properties.hs_lead_status !== hs_lead_status) {
        inputs.push({ id: c.id, properties: { lifecyclestage, hs_lead_status } });
        // going backwards down the funnel? HubSpot will ignore it unless cleared first.
        if (current && rank(lifecyclestage) < rank(current)) rewind.push({ id: c.id, properties: { lifecyclestage: '' } });
      }
    }

    // Clear first, in its own pass, so the subsequent set is always a forward move
    // from an empty value. Skipped entirely on a dry run.
    if (rewind.length && !dryRun) await batch('contacts', 'update', rewind);

    const r = await batch('contacts', 'update', inputs, { dryRun });
    return {
      matched: clients.length, drifted: inputs.length, rewound: rewind.length,
      changed: r.ok, failed: r.failed, wouldWrite: r.wouldWrite, dist,
    };
  },
};
