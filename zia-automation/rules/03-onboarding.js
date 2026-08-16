'use strict';
/**
 * WF-03  Onboarding Automation
 *
 * Native equivalent: "When a deal moves to Closed Won, create an onboarding ticket
 * associated to the deal, company and contact."
 *
 * Trigger : Closed Won deal with no existing onboarding ticket
 * Actions : create a Placement Onboarding ticket, wired to deal + company + contact
 * Idempotent: builds the set of deals that already have an onboarding ticket first,
 *             so re-running never duplicates.
 */
const { searchAll, batch, readAssociations, associatedIdSet, ASSOC, STAGE, TICKET_STAGE, OWNER_ID, TICKET_PIPELINE } = require('../lib/hubspot');

module.exports = {
  id: 'WF-03',
  name: 'Onboarding Automation',

  async run({ dryRun }) {
    // deals already covered by an onboarding ticket
    const existing = await searchAll('tickets', {
      properties: ['subject', 'zia_ticket_type'],
      filterGroups: [{ filters: [{ propertyName: 'zia_ticket_type', operator: 'EQ', value: 'onboarding' }] }],
    });

    const covered = await associatedIdSet('tickets', 'deals', existing.map(t => t.id));

    // closed-won deals
    const won = await searchAll('deals', {
      properties: ['dealname', 'amount', 'zia_deal_type', 'zia_placement_status', 'zia_embed_start_date'],
      filterGroups: [{ filters: [{ propertyName: 'dealstage', operator: 'EQ', value: STAGE.WON }] }],
    });

    const needs = won.filter(d => !covered.has(d.id));
    if (!needs.length) {
      return { matched: won.length, alreadyCovered: covered.size, created: 0, note: 'every closed-won deal already has an onboarding ticket' };
    }

    // company + contact associations for the deals that need a ticket
    const ids = needs.map(d => d.id);
    const assocCo = await readAssociations('deals', 'companies', ids);
    const assocCt = await readAssociations('deals', 'contacts', ids);

    const inputs = needs.map(d => {
      const assoc = [{ to: { id: d.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.TICKET_TO_DEAL }] }];
      const co = (assocCo.get(d.id) || [])[0], ct = (assocCt.get(d.id) || [])[0];
      if (co) assoc.push({ to: { id: co }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.TICKET_TO_COMPANY }] });
      if (ct) assoc.push({ to: { id: ct }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.TICKET_TO_CONTACT }] });

      return {
        properties: {
          subject: `Onboarding — ${d.properties.dealname}`,
          content: `Deal closed won at $${d.properties.amount || 0}. Confirm systems access, scheduling, and the week-1 checkpoint.`,
          hs_pipeline: TICKET_PIPELINE,
          hs_pipeline_stage: TICKET_STAGE.NEW,
          hs_ticket_priority: 'MEDIUM',
          hubspot_owner_id: OWNER_ID,
          zia_ticket_type: 'onboarding',
        },
        associations: assoc,
      };
    });

    const r = await batch('tickets', 'create', inputs, { dryRun });
    return { matched: won.length, alreadyCovered: covered.size, created: r.ok, failed: r.failed, wouldWrite: r.wouldWrite };
  },
};
