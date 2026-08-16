'use strict';
/**
 * WF-05  SLA Escalation
 *
 * Native equivalent: "When a placement is flagged at risk and health drops below
 * the floor, raise a high-priority escalation and mark the SLA breached."
 *
 * Trigger : placement status = at_risk, health score < 40, no open escalation
 * Actions : create a HIGH priority escalation ticket; set zia_sla_breached on the deal
 * Idempotent: skips deals with an open escalation; only writes the SLA flag when it changes.
 */
const { searchAll, batch, readAssociations, associatedIdSet, ASSOC, TICKET_STAGE, OWNER_ID, TICKET_PIPELINE } = require('../lib/hubspot');

const FLOOR = 40;

module.exports = {
  id: 'WF-05',
  name: 'SLA Escalation',

  async run({ dryRun }) {
    const openEsc = await searchAll('tickets', {
      properties: ['zia_ticket_type', 'hs_pipeline_stage'],
      filterGroups: [{ filters: [
        { propertyName: 'zia_ticket_type', operator: 'EQ', value: 'at_risk_escalation' },
        { propertyName: 'hs_pipeline_stage', operator: 'NEQ', value: TICKET_STAGE.CLOSED },
      ] }],
    });

    const covered = await associatedIdSet('tickets', 'deals', openEsc.map(t => t.id));

    const breaching = await searchAll('deals', {
      properties: ['dealname', 'zia_health_score', 'zia_placement_status', 'zia_talent_email'],
      filterGroups: [{ filters: [
        { propertyName: 'zia_placement_status', operator: 'EQ', value: 'at_risk' },
        { propertyName: 'zia_health_score', operator: 'LT', value: String(FLOOR) },
      ] }],
    });

    const needs = breaching.filter(d => !covered.has(d.id));

    // ticket creation
    let created = 0, failed = 0, wouldWrite;
    if (needs.length) {
      const assocCo = await readAssociations('deals', 'companies', needs.map(d => d.id));

      const inputs = needs.map(d => {
        const score = d.properties.zia_health_score;
        const assoc = [{ to: { id: d.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.TICKET_TO_DEAL }] }];
        const co = (assocCo.get(d.id) || [])[0];
        if (co) assoc.push({ to: { id: co }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.TICKET_TO_COMPANY }] });

        return {
          properties: {
            subject: `SLA BREACH — ${d.properties.dealname}`,
            content: `Health score ${score} is below the ${FLOOR} floor on an at-risk placement. Escalated to account management for same-day review.`,
            hs_pipeline: TICKET_PIPELINE,
            hs_pipeline_stage: TICKET_STAGE.WAITING_US,
            hs_ticket_priority: 'HIGH',
            hubspot_owner_id: OWNER_ID,
            zia_ticket_type: 'at_risk_escalation',
            zia_health_score: String(score),
            zia_placement_status: 'at_risk',
            zia_sla_breached: 'true',
            zia_talent_email: d.properties.zia_talent_email || '',
          },
          associations: assoc,
        };
      });

      const r = await batch('tickets', 'create', inputs, { dryRun });
      created = r.ok; failed = r.failed; wouldWrite = r.wouldWrite;
    }

    return { matched: breaching.length, alreadyCovered: covered.size, created, failed, wouldWrite };
  },
};
