'use strict';
/**
 * WF-11  Engagement Health Model
 *
 * WHY THIS EXISTS
 * Health score was the most load-bearing number in this portal and, until now, the
 * least defensible: it was seeded as a left-skewed random distribution centred near
 * 68. Every finding built on it — "144 engagements score below 60" — was therefore
 * a statement about a random draw, not about the business.
 *
 * A metric nobody can explain is a metric nobody should act on. This replaces it with
 * a composite computed from data the portal actually holds, where every point is
 * traceable to a field and a rep can be told exactly why their engagement scores 54.
 *
 * THE MODEL — 100 points across five signals
 *
 *   Delivery      30   are we delivering the hours we sold?
 *   Momentum      20   how recently has anything happened on this engagement?
 *   Issues        20   open escalations, health checks and SLA breaches against it
 *   Commercial    15   is the client actually paying?
 *   Sentiment     15   what did the client say when we asked?
 *
 * Signals are only counted when the evidence exists. An engagement with no NPS
 * response is not penalised for silence — its score is renormalised across the
 * signals that do have evidence, and `zia_health_basis` records which those were.
 * Scoring absence as badness is how health metrics quietly become tenure metrics.
 */
const { api, listAll, batch, readAssociations } = require('../lib/hubspot');

/**
 * WEIGHTING — second calibration.
 *
 * The first version scored "delivery" as committed hours ÷ 30, which measures how BIG
 * an engagement is, not how WELL it is going. Every engagement scored 0.87-1.0 on it.
 * Combined with generous bands elsewhere it produced 0 critical and 359 healthy out of
 * 500 — a model that contradicted the portal's own evidence, since 39 of those
 * engagements have an at-risk escalation ticket raised against them.
 *
 * Replaced with schedule adherence, which is measurable from the embed dates we hold,
 * and issues weighted highest — because a raised escalation is the strongest evidence
 * of trouble in this dataset, and a model should trust its most direct signal.
 */
const WEIGHTS = { schedule: 20, momentum: 15, issues: 35, commercial: 15, sentiment: 15 };

const PROPS = [
  { name: 'zia_health_basis', label: 'Health Basis', type: 'string', fieldType: 'textarea',
    description: 'Which signals contributed to the health score, and what each scored. '
      + 'Written by WF-11 so the number is explainable on the record.' },
  { name: 'zia_health_prev', label: 'Previous Health Score', type: 'number', fieldType: 'number',
    description: 'The score before the last recalculation, so movement is visible.' },
];

const daysSince = iso => iso ? (Date.now() - new Date(iso)) / 864e5 : null;
const clamp01 = n => Math.max(0, Math.min(1, n));

module.exports = {
  id: 'WF-11',
  name: 'Engagement Health Model',

  async run({ dryRun }) {
    if (!dryRun) {
      for (const p of PROPS) {
        try { await api('POST', '/crm/v3/properties/deals', { ...p, groupName: 'dealinformation' }); }
        catch (e) { if (!String(e.message).includes('already exists')) throw e; }
      }
    }

    // `notes_last_contacted` is the last real client contact (call/email/meeting).
    // NOT `notes_last_activity_date` — that property does not exist on the deal
    // schema, and HubSpot silently omits unknown properties instead of erroring,
    // which is how the momentum signal went missing for a full release. NOT
    // `hs_notes_last_activity` either: it returns an engagement *reference*
    // (`0-46-391441743577`), not a timestamp.
    const deals = await listAll('deals', [
      'dealname', 'zia_placement_status', 'zia_health_score', 'zia_hours_per_week',
      'zia_embed_start_date', 'zia_embed_end_date', 'zia_invoice_status',
      'zia_days_outstanding', 'notes_last_contacted', 'notes_last_updated', 'zia_deal_type',
      // Required for the diff below. Omitting it made every comparison read undefined,
      // so the rule rewrote all 500 records on every run and never converged.
      'zia_health_basis',
    ]);
    const placements = deals.filter(d => d.properties.zia_placement_status);
    if (!placements.length) return { matched: 0, note: 'no placements' };

    const ids = placements.map(d => d.id);

    // ---- issue signal: tickets raised against each engagement ----
    const tickets = await listAll('tickets', [
      'zia_ticket_type', 'hs_pipeline_stage', 'zia_sla_breached', 'hs_ticket_priority',
    ]);
    const ticketDeal = await readAssociations('tickets', 'deals', tickets.map(t => t.id));
    const issuesByDeal = new Map();
    for (const t of tickets) {
      const p = t.properties;
      const open = p.hs_pipeline_stage !== '4';
      for (const d of ticketDeal.get(String(t.id)) || []) {
        const rec = issuesByDeal.get(d) || { open: 0, escalations: 0, breaches: 0 };
        if (open) rec.open++;
        if (p.zia_ticket_type === 'at_risk_escalation') rec.escalations++;
        if (p.zia_sla_breached === 'true') rec.breaches++;
        issuesByDeal.set(d, rec);
      }
    }

    // ---- sentiment signal: NPS from contacts at the client company ----
    const contacts = await listAll('contacts', ['zia_nps_score', 'zia_contact_type']);
    const contactCompany = await readAssociations('contacts', 'companies',
      contacts.filter(c => c.properties.zia_nps_score !== null
        && c.properties.zia_nps_score !== undefined
        && c.properties.zia_nps_score !== '').map(c => c.id));
    const npsByCompany = new Map();
    for (const c of contacts) {
      const s = c.properties.zia_nps_score;
      if (s === null || s === undefined || s === '') continue;
      for (const co of contactCompany.get(String(c.id)) || []) {
        const arr = npsByCompany.get(co) || [];
        arr.push(+s);
        npsByCompany.set(co, arr);
      }
    }
    const dealCompany = await readAssociations('deals', 'companies', ids);

    // ---- score ----
    const updates = [];
    const buckets = { 'Critical (<40)': 0, 'At risk (40-59)': 0, 'Watch (60-79)': 0, 'Healthy (80+)': 0 };
    let moved = 0;

    for (const d of placements) {
      const p = d.properties;
      const parts = [];
      let earned = 0, available = 0;

      // 1. SCHEDULE ADHERENCE — is the engagement running to plan?
      // Overrunning its planned end while still active is the clearest schedule
      // signal available; ending early is the second.
      const start = p.zia_embed_start_date, end = p.zia_embed_end_date;
      if (start && end) {
        const overrun = -daysSince(end);            // negative once the end date has passed
        const status = p.zia_placement_status;
        let ratio;
        if (status === 'ended') {
          ratio = 1;                                 // completed as planned
        } else if (overrun >= 0) {
          ratio = 1;                                 // still within plan
        } else {
          ratio = clamp01(1 - Math.abs(overrun) / 90); // decays over a quarter of overrun
        }
        earned += WEIGHTS.schedule * ratio;
        available += WEIGHTS.schedule;
        // Describe the ratio that was actually applied, NOT the raw overrun. An ended
        // engagement scores full marks on schedule, so printing "136d over" produced
        // records reading `100/100 — schedule 136d over`: an explanation that flatly
        // contradicts its own score. A basis field nobody can trust is worse than none.
        parts.push('schedule ' + (
          status === 'ended' ? 'completed'
            : overrun >= 0 ? 'on plan'
              : Math.round(Math.abs(overrun)) + 'd over'));
      }

      // 2. MOMENTUM — how long since we last actually spoke to the client.
      // Scored only for engagements that are still running. A finished engagement
      // is SUPPOSED to go quiet; charging it for that would turn health into a
      // measure of age rather than of trouble.
      const since = daysSince(p.notes_last_contacted || p.notes_last_updated);
      if (since !== null && p.zia_placement_status !== 'ended') {
        const ratio = since <= 7 ? 1 : since <= 21 ? 0.7 : since <= 45 ? 0.4 : since <= 90 ? 0.15 : 0;
        earned += WEIGHTS.momentum * ratio;
        available += WEIGHTS.momentum;
        // Report the BAND, not the exact day count. The score only moves when a band
        // boundary is crossed, but an exact figure changes every single day — which
        // made the basis text differ on every run and stopped the rule converging.
        // The label must be as stable as the number it explains.
        const band = since <= 7 ? 'within 7d' : since <= 21 ? '8-21d' : since <= 45 ? '22-45d'
          : since <= 90 ? '46-90d' : 'over 90d';
        parts.push(`momentum ${band} since contact`);
      }

      // 3. ISSUES — the most direct evidence of trouble, so the heaviest weight.
      // An escalation alone should be enough to pull an engagement out of "healthy".
      const iss = issuesByDeal.get(String(d.id)) || { open: 0, escalations: 0, breaches: 0 };
      const penalty = clamp01((iss.open * 0.18) + (iss.escalations * 0.65) + (iss.breaches * 0.45));
      earned += WEIGHTS.issues * (1 - penalty);
      available += WEIGHTS.issues;
      parts.push(`issues ${iss.open} open/${iss.escalations} esc/${iss.breaches} breach`);

      // 4. COMMERCIAL — only where an invoice exists
      const inv = p.zia_invoice_status;
      if (inv) {
        const days = +p.zia_days_outstanding || 0;
        const ratio = inv === 'paid' ? 1
          : inv === 'draft' ? 0.9
            : inv === 'sent' ? 0.85
              : inv === 'written_off' ? 0
                : clamp01(1 - days / 120);            // overdue, decaying with age
        earned += WEIGHTS.commercial * ratio;
        available += WEIGHTS.commercial;
        parts.push(`commercial ${inv}`);
      }

      // 5. SENTIMENT — only where the client actually answered
      const co = (dealCompany.get(String(d.id)) || [])[0];
      const nps = co ? npsByCompany.get(co) : null;
      if (nps && nps.length) {
        const mean = nps.reduce((a, b) => a + b, 0) / nps.length;
        earned += WEIGHTS.sentiment * clamp01(mean / 10);
        available += WEIGHTS.sentiment;
        parts.push(`sentiment NPS ${mean.toFixed(1)}`);
      }

      // renormalise across the signals that had evidence
      const score = available ? Math.round((earned / available) * 100) : 50;

      const h = score;
      if (h < 40) buckets['Critical (<40)']++;
      else if (h < 60) buckets['At risk (40-59)']++;
      else if (h < 80) buckets['Watch (60-79)']++;
      else buckets['Healthy (80+)']++;

      const prev = +p.zia_health_score || 0;
      const basis = `${score}/100 — ${parts.join(' · ')}`;

      // Reconcile the REASONING as well as the number. Diffing on the score alone
      // meant a corrected explanation could never reach a record whose score had not
      // moved — the rule was unable to repair its own output.
      if (prev !== score || p.zia_health_basis !== basis) {
        if (prev !== score) moved++;
        updates.push({
          id: d.id,
          properties: {
            zia_health_score: score,
            zia_health_prev: prev,
            zia_health_basis: basis,
          },
        });
      }
    }

    if (dryRun) {
      return { matched: placements.length, wouldWrite: updates.length, changed: moved, buckets };
    }

    const r = await batch('deals', 'update', updates);
    return { matched: placements.length, rescored: r.ok, failed: r.failed, buckets };
  },
};
