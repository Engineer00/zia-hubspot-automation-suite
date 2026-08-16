'use strict';
/**
 * WF-01  Lead Routing
 *
 * Native equivalent: "When a contact is created, if unassigned, set owner and lead status."
 *
 * Trigger : client contact with no owner, or no lead status
 * Actions : assign owner, set hs_lead_status, set lifecyclestage to lead
 * Idempotent: only touches records that are actually missing those values.
 */
const { searchAll, batch, OWNER_ID } = require('../lib/hubspot');

module.exports = {
  id: 'WF-01',
  name: 'Lead Routing',

  async run({ dryRun }) {
    const unrouted = await searchAll('contacts', {
      properties: ['email', 'zia_contact_type', 'hubspot_owner_id', 'hs_lead_status', 'lifecyclestage'],
      filterGroups: [
        { filters: [
          { propertyName: 'zia_contact_type', operator: 'EQ', value: 'client_contact' },
          { propertyName: 'hubspot_owner_id', operator: 'NOT_HAS_PROPERTY' },
        ] },
        { filters: [
          { propertyName: 'zia_contact_type', operator: 'EQ', value: 'client_contact' },
          { propertyName: 'hs_lead_status', operator: 'NOT_HAS_PROPERTY' },
        ] },
      ],
    });

    if (!unrouted.length) return { matched: 0, changed: 0, note: 'all client contacts already routed' };

    const inputs = unrouted.map(c => {
      const props = { hubspot_owner_id: OWNER_ID };
      if (!c.properties.hs_lead_status) props.hs_lead_status = 'NEW';
      if (!c.properties.lifecyclestage) props.lifecyclestage = 'lead';
      return { id: c.id, properties: props };
    });

    const r = await batch('contacts', 'update', inputs, { dryRun });
    return { matched: unrouted.length, changed: r.ok, failed: r.failed, wouldWrite: r.wouldWrite };
  },
};
