'use strict';
/**
 * WF-10  Feedback Loop — NPS rollup and detractor recovery
 *
 * Native equivalent: HubSpot Feedback Surveys (NPS / CSAT / CES), which are Service
 * Hub Professional, plus a workflow to alert on detractors. Neither is available here.
 *
 * Collecting a score is the easy half and the half most companies stop at. The half
 * that matters is what happens next: a detractor with no follow-up is worse than no
 * survey, because you have now asked someone to tell you they are unhappy and then
 * visibly done nothing.
 *
 * Trigger : a client contact with an NPS response
 * Actions :
 *   - categorise (promoter 9-10, passive 7-8, detractor 0-6)
 *   - roll the true NPS up to the account: %promoters - %detractors, not an average
 *   - raise a recovery ticket for every detractor without one
 *   - flag accounts where feedback and delivery health DISAGREE
 *
 * Idempotent: categories are pure functions of the score, rollups are recomputed and
 * only written when changed, and recovery tickets are deduped by association.
 */
const {
  api, searchAll, listAll, batch, readAssociations, associatedIdSet,
  ASSOC, TICKET_STAGE, OWNER_ID, TICKET_PIPELINE,
} = require('../lib/hubspot');

const categoryOf = s => s >= 9 ? 'promoter' : s >= 7 ? 'passive' : 'detractor';

module.exports = {
  id: 'WF-10',
  name: 'Feedback Loop (NPS)',

  async run({ dryRun }) {
    const contacts = await listAll('contacts', [
      'email', 'firstname', 'lastname', 'zia_contact_type',
      'zia_nps_score', 'zia_nps_category', 'zia_nps_comment', 'zia_nps_date',
    ]);
    const responded = contacts.filter(c =>
      c.properties.zia_contact_type === 'client_contact' &&
      c.properties.zia_nps_score !== null &&
      c.properties.zia_nps_score !== undefined &&
      c.properties.zia_nps_score !== '');

    if (!responded.length) return { matched: 0, note: 'no NPS responses yet' };

    // ---- 1. categorise where the stored category disagrees with the score ----
    const recat = [];
    for (const c of responded) {
      const want = categoryOf(+c.properties.zia_nps_score);
      if (c.properties.zia_nps_category !== want) {
        recat.push({ id: c.id, properties: { zia_nps_category: want } });
      }
    }

    // ---- 2. roll up to the account ----
    const contactCompany = await readAssociations('contacts', 'companies', responded.map(c => c.id));
    const byCompany = new Map();
    for (const c of responded) {
      const co = (contactCompany.get(String(c.id)) || [])[0];
      if (!co) continue;
      const arr = byCompany.get(co) || [];
      arr.push(+c.properties.zia_nps_score);
      byCompany.set(co, arr);
    }

    const companies = await listAll('companies', ['name', 'zia_nps_avg', 'zia_nps_responses', 'zia_client_health']);
    const companyById = new Map(companies.map(c => [String(c.id), c]));

    const rollups = [];
    for (const [co, scores] of byCompany) {
      // true NPS: %promoters minus %detractors. An average of 0-10 scores is NOT
      // an NPS and reads far more flattering than the real number.
      const promoters = scores.filter(s => s >= 9).length;
      const detractors = scores.filter(s => s <= 6).length;
      const nps = Math.round(((promoters - detractors) / scores.length) * 100);

      const existing = companyById.get(String(co));
      if (!existing) continue;
      const cur = existing.properties;
      if (String(cur.zia_nps_avg ?? '') !== String(nps)
        || String(cur.zia_nps_responses ?? '') !== String(scores.length)) {
        rollups.push({ id: co, properties: { zia_nps_avg: nps, zia_nps_responses: scores.length } });
      }
    }

    // ---- 3. recovery tickets for detractors ----
    const detractorContacts = responded.filter(c => categoryOf(+c.properties.zia_nps_score) === 'detractor');

    const existingTickets = await searchAll('tickets', {
      properties: ['subject', 'zia_ticket_type'],
      filterGroups: [{ filters: [{ propertyName: 'zia_ticket_type', operator: 'EQ', value: 'nps_detractor' }] }],
    });
    const covered = await associatedIdSet('tickets', 'contacts', existingTickets.map(t => t.id));

    const needTicket = detractorContacts.filter(c => !covered.has(String(c.id)));

    const newTickets = needTicket.map(c => {
      const p = c.properties;
      const name = [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email;
      const co = (contactCompany.get(String(c.id)) || [])[0];
      const assoc = [{ to: { id: c.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.TICKET_TO_CONTACT }] }];
      if (co) assoc.push({ to: { id: co }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.TICKET_TO_COMPANY }] });

      return {
        properties: {
          subject: `Detractor recovery — ${name} (NPS ${p.zia_nps_score})`,
          content: `Scored ${p.zia_nps_score}/10.\n\n"${p.zia_nps_comment || 'No comment left.'}"\n\n`
            + `Call within 5 working days. Do not send a survey follow-up email — a detractor `
            + `who receives automated marketing after complaining escalates.`,
          hs_pipeline: TICKET_PIPELINE,
          hs_pipeline_stage: TICKET_STAGE.NEW,
          hs_ticket_priority: 'HIGH',
          hubspot_owner_id: OWNER_ID,
          zia_ticket_type: 'nps_detractor',
        },
        associations: assoc,
      };
    });

    // ---- 4. where feedback and delivery health disagree ----
    // The valuable cases are the contradictions: an account the delivery metric calls
    // healthy whose client is a detractor, or the reverse.
    let healthyButUnhappy = 0, unhealthyButHappy = 0;
    for (const [co, scores] of byCompany) {
      const c = companyById.get(String(co));
      if (!c) continue;
      const health = c.properties.zia_client_health;
      const worst = Math.min(...scores);
      if (health === 'healthy' && worst <= 6) healthyButUnhappy++;
      if (health === 'at_risk' && worst >= 9) unhealthyButHappy++;
    }

    if (dryRun) {
      return {
        matched: responded.length,
        wouldRecategorise: recat.length,
        wouldRollUp: rollups.length,
        wouldTicket: newTickets.length,
        detractors: detractorContacts.length,
        healthyButUnhappy, unhealthyButHappy,
        wouldWrite: recat.length + rollups.length + newTickets.length,
      };
    }

    const a = await batch('contacts', 'update', recat);
    const b = await batch('companies', 'update', rollups);
    const t = await batch('tickets', 'create', newTickets);

    return {
      matched: responded.length,
      recategorised: a.ok,
      accountsRolledUp: b.ok,
      recoveryTickets: t.ok,
      detractors: detractorContacts.length,
      healthyButUnhappy, unhealthyButHappy,
      failed: a.failed + b.failed + t.failed,
    };
  },
};
