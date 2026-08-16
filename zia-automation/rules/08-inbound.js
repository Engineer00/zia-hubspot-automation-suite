'use strict';
/**
 * WF-08  Inbound Lead Processing
 *
 * Native equivalent: a form-submission workflow — "when a contact submits a form,
 * associate them to a company, assign an owner, and create a follow-up task with
 * an SLA." Four native features in one, none of which exist on this tier.
 *
 * This is the rule that makes the front door actually connect to the CRM. A form
 * submission gives you a contact carrying a company NAME as text. It does not give
 * you a company RECORD, and an unassociated contact is invisible to every
 * company-level report in the portal.
 *
 * Trigger : any contact whose zia_source starts "website_"
 * Actions :
 *   client  — resolve the company by email domain (create it if new), associate as
 *             primary, own it, stage it, and raise a HIGH-priority enquiry ticket
 *   talent  — associate to the ZIA operating company, own it; compliance is WF-06's job
 *   both    — flag the enquiry ticket SLA-breached once it is 24h old and still open
 *
 * Idempotent: every action is guarded by reading current state first. A contact that
 * is already associated, owned and ticketed produces no writes.
 */
const {
  api, searchAll, listAll, batch, readAssociations, associatedIdSet,
  ASSOC, TICKET_STAGE, OWNER_ID, TICKET_PIPELINE,
} = require('../lib/hubspot');

const EMPLOYER_NAME = 'ZIA Organizational Development';
const SLA_HOURS = 24;

/** Public mailbox providers never identify a company. */
const FREEMAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'live.com', 'aol.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com',
]);

const domainOf = email => {
  const d = String(email || '').split('@')[1];
  return d ? d.toLowerCase() : null;
};

const titleFromDomain = d => d.replace(/\.[a-z.]+$/, '')
  .split(/[-.]/).filter(Boolean)
  .map(w => w[0].toUpperCase() + w.slice(1))
  .join(' ');

module.exports = {
  id: 'WF-08',
  name: 'Inbound Lead Processing',

  async run({ dryRun }) {
    // ---- unprocessed client contacts ----
    //
    // This originally triggered on `zia_source CONTAINS_TOKEN website_*`, which broke
    // twice over: P13 later converted zia_source into an enumeration whose options do
    // not include the form's hidden values, so the forms write a rejected value; and
    // matching on source is fragile in principle — it asks "how did this arrive?"
    // when the question that matters is "has this been dealt with?".
    //
    // Reconciling on STATE instead catches an unprocessed lead no matter how it got
    // here: a form, an import, a manual entry, or an integration built next year.
    const all = await listAll('contacts', ['email', 'firstname', 'lastname', 'company',
      'zia_contact_type', 'zia_source', 'zia_interest', 'hubspot_owner_id',
      'hs_lead_status', 'lifecyclestage', 'createdate']);

    const clients = all.filter(c => c.properties.zia_contact_type === 'client_contact');
    const linkedPre = await readAssociations('contacts', 'companies', clients.map(c => c.id));

    const inbound = clients.filter(c => {
      const p = c.properties;
      const noCompany = !(linkedPre.get(String(c.id)) || []).length;
      return noCompany || !p.hubspot_owner_id || !p.hs_lead_status;
    });

    if (!inbound.length) {
      return { matched: 0, note: 'every client contact is associated, owned and staged' };
    }

    const ids = inbound.map(c => c.id);
    const companyLinks = await readAssociations('contacts', 'companies', ids);

    // contacts that already have an enquiry ticket
    const enquiryTickets = await searchAll('tickets', {
      properties: ['subject', 'zia_ticket_type', 'hs_pipeline_stage', 'createdate', 'zia_sla_breached'],
      filterGroups: [{ filters: [
        { propertyName: 'zia_ticket_type', operator: 'EQ', value: 'inbound_lead' },
      ] }],
    });
    const ticketed = await associatedIdSet('tickets', 'contacts', enquiryTickets.map(t => t.id));

    // ---- resolve the employer once, for consultant applications ----
    const employerHit = await searchAll('companies', {
      properties: ['name'],
      filterGroups: [{ filters: [{ propertyName: 'name', operator: 'EQ', value: EMPLOYER_NAME }] }],
    });
    const employerId = employerHit.length ? employerHit[0].id : null;

    // ---- resolve a company per client contact ----
    const domainCache = new Map();
    async function resolveCompany(contact) {
      if (contact.properties.zia_contact_type === 'talent') return employerId;

      const domain = domainOf(contact.properties.email);
      if (!domain || FREEMAIL.has(domain)) return null;   // cannot infer an org
      if (domainCache.has(domain)) return domainCache.get(domain);

      const hit = await searchAll('companies', {
        properties: ['name', 'domain'],
        filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: domain }] }],
      });

      let id = hit.length ? hit[0].id : null;
      if (!id && !dryRun) {
        const created = await api('POST', '/crm/v3/objects/companies', {
          properties: {
            name: contact.properties.company || titleFromDomain(domain),
            domain,
            website: `https://www.${domain}`,
            zia_company_stage: 'active_client',
            hubspot_owner_id: OWNER_ID,
          },
        });
        id = created.id;
      }
      domainCache.set(domain, id);
      return id;
    }

    // ---- plan the work ----
    const contactUpdates = [];
    const associations = [];
    const newTickets = [];
    let companiesCreated = 0;
    const before = domainCache.size;

    for (const c of inbound) {
      const p = c.properties;
      const linked = companyLinks.get(String(c.id)) || [];
      const companyId = linked.length ? linked[0] : await resolveCompany(c);

      if (!linked.length && companyId) {
        associations.push({ contactId: c.id, companyId });
      }

      // owner + staging, only where missing
      const props = {};
      if (!p.hubspot_owner_id) props.hubspot_owner_id = OWNER_ID;
      if (!p.hs_lead_status) props.hs_lead_status = 'NEW';
      if (!p.lifecyclestage) props.lifecyclestage = 'lead';
      if (Object.keys(props).length) contactUpdates.push({ id: c.id, properties: props });

      // one enquiry ticket per inbound contact
      if (!ticketed.has(String(c.id))) {
        const name = [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email;
        const isTalent = p.zia_contact_type === 'talent';
        const assoc = [{ to: { id: c.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.TICKET_TO_CONTACT }] }];
        if (companyId) assoc.push({ to: { id: companyId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.TICKET_TO_COMPANY }] });

        newTickets.push({
          properties: {
            subject: isTalent ? `Consultant application — ${name}` : `New enquiry — ${name}`,
            content: isTalent
              ? `Applied through the website. Review experience and coverage, then start compliance onboarding.`
              : `Enquiry submitted through the website${p.zia_interest ? ` about ${p.zia_interest}` : ''}.`
                + ` Respond within ${SLA_HOURS} hours.`,
            hs_pipeline: TICKET_PIPELINE,
            hs_pipeline_stage: TICKET_STAGE.NEW,
            hs_ticket_priority: isTalent ? 'MEDIUM' : 'HIGH',
            hubspot_owner_id: OWNER_ID,
            zia_ticket_type: 'inbound_lead',
          },
          associations: assoc,
        });
      }
    }
    companiesCreated = domainCache.size - before;

    // ---- speed-to-lead: breach anything still open past the SLA ----
    const cutoff = Date.now() - SLA_HOURS * 3600e3;
    const breaches = enquiryTickets
      .filter(t => t.properties.hs_pipeline_stage !== TICKET_STAGE.CLOSED)
      .filter(t => new Date(t.properties.createdate).getTime() < cutoff)
      .filter(t => t.properties.zia_sla_breached !== 'true')
      .map(t => ({ id: t.id, properties: { zia_sla_breached: 'true', hs_ticket_priority: 'HIGH' } }));

    if (dryRun) {
      return {
        matched: inbound.length,
        wouldAssociate: associations.length,
        wouldUpdate: contactUpdates.length,
        wouldTicket: newTickets.length,
        wouldBreach: breaches.length,
        wouldWrite: associations.length + contactUpdates.length + newTickets.length + breaches.length,
      };
    }

    // associations one at a time — v4 batch create takes a different shape and this
    // volume is inbound-sized, not migration-sized
    let associated = 0;
    for (const a of associations) {
      await api('PUT', `/crm/v4/objects/contacts/${a.contactId}/associations/companies/${a.companyId}`, [
        { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.CONTACT_TO_COMPANY },
      ]);
      associated++;
    }

    const cu = await batch('contacts', 'update', contactUpdates);
    const nt = await batch('tickets', 'create', newTickets);
    const br = await batch('tickets', 'update', breaches);

    return {
      matched: inbound.length,
      companiesCreated,
      associated,
      routed: cu.ok,
      ticketed: nt.ok,
      slaBreached: br.ok,
      failed: cu.failed + nt.failed + br.failed,
    };
  },
};
