'use strict';
/**
 * WF-06  Compliance Tracking
 *
 * Native equivalent: "When a talent record's compliance lapses or is due to expire,
 * open a compliance review and hold them off the bench."
 *
 * Trigger : talent contact with compliance status lapsed / expiring_soon / not_started
 * Actions : lapsed or not_started -> force bench status to in_assessment (cannot be placed)
 *           any of the three       -> open a Compliance Review ticket, one per contact
 * Idempotent: bench writes only where the value actually changes; tickets deduped
 *             against open compliance tickets by talent email.
 */
const { searchAll, batch, ASSOC, TICKET_STAGE, OWNER_ID, TICKET_PIPELINE } = require('../lib/hubspot');

const BLOCKING = ['lapsed', 'not_started'];
const ALL = ['lapsed', 'not_started', 'expiring_soon'];

module.exports = {
  id: 'WF-06',
  name: 'Compliance Tracking',

  async run({ dryRun }) {
    const flagged = await searchAll('contacts', {
      properties: ['email', 'firstname', 'lastname', 'zia_contact_type', 'zia_compliance_status', 'zia_bench_status'],
      filterGroups: ALL.map(v => ({ filters: [
        { propertyName: 'zia_contact_type', operator: 'EQ', value: 'talent' },
        { propertyName: 'zia_compliance_status', operator: 'EQ', value: v },
      ] })),
    });

    if (!flagged.length) return { matched: 0, benched: 0, ticketed: 0, note: 'all talent compliant' };

    // 1. hold blocking cases off the bench
    const benchInputs = flagged
      .filter(c => BLOCKING.includes(c.properties.zia_compliance_status))
      .filter(c => c.properties.zia_bench_status !== 'in_assessment')
      .map(c => ({ id: c.id, properties: { zia_bench_status: 'in_assessment' } }));

    const benchRes = await batch('contacts', 'update', benchInputs, { dryRun });

    // 2. dedupe against open compliance tickets
    const openTickets = await searchAll('tickets', {
      properties: ['zia_ticket_type', 'zia_talent_email', 'hs_pipeline_stage'],
      filterGroups: [{ filters: [
        { propertyName: 'zia_ticket_type', operator: 'EQ', value: 'compliance_review' },
        { propertyName: 'hs_pipeline_stage', operator: 'NEQ', value: TICKET_STAGE.CLOSED },
      ] }],
    });
    const covered = new Set(openTickets.map(t => (t.properties.zia_talent_email || '').toLowerCase()));

    const needs = flagged.filter(c => !covered.has((c.properties.email || '').toLowerCase()));

    const ticketInputs = needs.map(c => {
      const status = c.properties.zia_compliance_status;
      const who = `${c.properties.firstname || ''} ${c.properties.lastname || ''}`.trim() || c.properties.email;
      const blocking = BLOCKING.includes(status);
      return {
        properties: {
          subject: `Compliance review (${status.replace('_', ' ')}) — ${who}`,
          content: blocking
            ? `Compliance is ${status}. Talent moved to In Assessment and is not placeable until cleared.`
            : `Compliance expires soon. Renew before the next placement window to avoid a bench hold.`,
          hs_pipeline: TICKET_PIPELINE,
          hs_pipeline_stage: blocking ? TICKET_STAGE.WAITING_US : TICKET_STAGE.NEW,
          hs_ticket_priority: blocking ? 'HIGH' : 'LOW',
          hubspot_owner_id: OWNER_ID,
          zia_ticket_type: 'compliance_review',
          zia_talent_email: c.properties.email || '',
          zia_sla_breached: String(status === 'lapsed'),
        },
        associations: [{ to: { id: c.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.TICKET_TO_CONTACT }] }],
      };
    });

    const ticketRes = await batch('tickets', 'create', ticketInputs, { dryRun });

    const byStatus = {};
    for (const c of flagged) {
      const s = c.properties.zia_compliance_status;
      byStatus[s] = (byStatus[s] || 0) + 1;
    }

    return {
      matched: flagged.length,
      byStatus,
      benched: benchRes.ok,
      ticketed: ticketRes.ok,
      failed: benchRes.failed + ticketRes.failed,
      wouldWrite: (benchRes.wouldWrite || 0) + (ticketRes.wouldWrite || 0),
    };
  },
};
