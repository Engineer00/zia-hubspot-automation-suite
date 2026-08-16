'use strict';
/**
 * WF-04  Placement Health Monitoring
 *
 * Native equivalent: "Every 30 days, re-evaluate active placements and open a
 * health-check ticket where the score has fallen below target."
 *
 * Trigger : active placement, health score 40-69, no open health-check ticket
 * Actions : create a Health Check ticket; refresh the deal's placement status
 * Idempotent: skips deals that already carry an open health-check ticket.
 */
const { searchAll, batch, readAssociations, associatedIdSet, ASSOC, TICKET_STAGE, OWNER_ID, TICKET_PIPELINE } = require('../lib/hubspot');

const TARGET = 70;
const FLOOR = 40; // below this it is an SLA escalation (WF-05), not a health check

module.exports = {
  id: 'WF-04',
  name: 'Placement Health Monitoring',

  async run({ dryRun }) {
    const openChecks = await searchAll('tickets', {
      properties: ['zia_ticket_type', 'hs_pipeline_stage'],
      filterGroups: [{ filters: [
        { propertyName: 'zia_ticket_type', operator: 'EQ', value: 'health_check' },
        { propertyName: 'hs_pipeline_stage', operator: 'NEQ', value: TICKET_STAGE.CLOSED },
      ] }],
    });

    const covered = await associatedIdSet('tickets', 'deals', openChecks.map(t => t.id));

    const atRiskOfDrift = await searchAll('deals', {
      properties: ['dealname', 'zia_health_score', 'zia_placement_status', 'zia_talent_email'],
      filterGroups: [{ filters: [
        { propertyName: 'zia_placement_status', operator: 'EQ', value: 'active' },
        { propertyName: 'zia_health_score', operator: 'LT', value: String(TARGET) },
        { propertyName: 'zia_health_score', operator: 'GTE', value: String(FLOOR) },
      ] }],
    });

    const needs = atRiskOfDrift.filter(d => !covered.has(d.id));
    if (!needs.length) {
      return { matched: atRiskOfDrift.length, alreadyCovered: covered.size, created: 0, note: 'no new health checks required' };
    }

    const assocCo = await readAssociations('deals', 'companies', needs.map(d => d.id));

    const inputs = needs.map(d => {
      const score = d.properties.zia_health_score;
      const assoc = [{ to: { id: d.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.TICKET_TO_DEAL }] }];
      const co = (assocCo.get(d.id) || [])[0];
      if (co) assoc.push({ to: { id: co }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.TICKET_TO_COMPANY }] });

      return {
        properties: {
          subject: `30-day health check — ${d.properties.dealname}`,
          content: `Health score ${score} is below the ${TARGET} target. Schedule a client check-in and confirm coverage hours.`,
          hs_pipeline: TICKET_PIPELINE,
          hs_pipeline_stage: TICKET_STAGE.WAITING_US,
          hs_ticket_priority: 'MEDIUM',
          hubspot_owner_id: OWNER_ID,
          zia_ticket_type: 'health_check',
          zia_health_score: String(score),
          zia_placement_status: 'active',
          zia_sla_breached: 'false',
          zia_talent_email: d.properties.zia_talent_email || '',
        },
        associations: assoc,
      };
    });

    const r = await batch('tickets', 'create', inputs, { dryRun });
    return { matched: atRiskOfDrift.length, alreadyCovered: covered.size, created: r.ok, failed: r.failed, wouldWrite: r.wouldWrite };
  },
};
