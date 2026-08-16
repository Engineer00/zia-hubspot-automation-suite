'use strict';
/**
 * WF-13  Consultant Matching
 *
 * WHY THIS EXISTS
 * ZIA's business is connecting the right professional to the right organization. Until
 * P26 the CRM could only answer *who is free and in the right timezone* — because that
 * was the entire consultant model. The consequence is measurable: **"Specialty
 * experience" is the largest recorded loss reason, 45 deals worth $1,785,558**, and no
 * field existed to report on it.
 *
 * This rule scores every bench consultant against every unstaffed engagement and writes
 * the shortlist onto the deal, so a delivery manager opens the record and sees three
 * named people with the reason attached — rather than scrolling a bench of 187.
 *
 * THE MODEL — 100 points
 *
 *   Sector experience   30   have they worked in this client's industry before
 *   Service line        25   can they actually deliver what was sold
 *   Track record        20   their measured average delivered health
 *   Coverage            15   timezone overlap with the client
 *   Capacity            10   hours left before the 40/week ceiling
 *
 * Sector and service line together are 55% of the score, because those are exactly the
 * two things the loss data says the business gets wrong.
 *
 * HARD FILTERS, applied before scoring — these are not preferences:
 *   · compliance must be clear          (WF-06 holds the rest off the bench)
 *   · must not already be at 40 hrs/week
 *   · Summit engagements need Principal or Partner grade
 *
 * Idempotent: the shortlist is a pure function of current state, so a re-run writes the
 * same string and the rule converges.
 */
const { api, listAll, batch, readAssociations } = require('../lib/hubspot');

const MAX_HOURS = 40;
const W = { sector: 30, line: 25, record: 20, coverage: 15, capacity: 10 };
const SENIOR = ['Principal', 'Partner'];

const PROPS = [
  { name: 'zia_match_shortlist', label: 'Consultant Shortlist', type: 'string', fieldType: 'textarea',
    description: 'Top consultant matches with score and reason. Written by WF-13 so the '
      + 'staffing decision is explainable on the record.' },
  { name: 'zia_match_best_score', label: 'Best Match Score', type: 'number', fieldType: 'number',
    description: 'Score of the strongest available consultant for this engagement (0-100). '
      + 'A low value means the bench cannot serve the work that was sold.' },
];

const multi = v => (v || '').split(';').map(s => s.trim()).filter(Boolean);

module.exports = {
  id: 'WF-13',
  name: 'Consultant Matching',

  async run({ dryRun }) {
    if (!dryRun) {
      for (const p of PROPS) {
        try { await api('POST', '/crm/v3/properties/deals', { ...p, groupName: 'dealinformation' }); }
        catch (e) { if (!String(e.message).includes('already exists')) throw e; }
      }
    }

    const deals = await listAll('deals', ['dealname', 'zia_deal_type', 'zia_placement_status',
      'zia_service_type', 'zia_hours_per_week', 'zia_talent_email', 'zia_match_shortlist',
      'zia_match_best_score']);
    const placements = deals.filter(d => d.properties.zia_deal_type && d.properties.zia_placement_status);
    const active = placements.filter(d => d.properties.zia_placement_status === 'active');
    if (!active.length) return { matched: 0, note: 'no active engagements' };

    const contacts = await listAll('contacts', ['email', 'firstname', 'lastname', 'zia_contact_type',
      'zia_compliance_status', 'zia_sector_expertise', 'zia_service_lines', 'zia_coverage_band',
      'zia_avg_delivered_health', 'zia_seniority', 'zia_years_experience']);
    const talent = contacts.filter(c => c.properties.zia_contact_type === 'talent');

    const companies = await listAll('companies', ['name', 'zia_industry', 'state']);
    const coById = new Map(companies.map(c => [String(c.id), c]));
    const dealCompany = await readAssociations('deals', 'companies', active.map(d => d.id));

    // current load per consultant, so capacity is real rather than assumed
    const load = new Map();
    for (const d of placements) {
      if (d.properties.zia_placement_status !== 'active') continue;
      const e = d.properties.zia_talent_email;
      if (e) load.set(e, (load.get(e) || 0) + (+d.properties.zia_hours_per_week || 0));
    }

    // Client timezone is inferred from state the same way WF-09 derives territory.
    const WEST = ['CA', 'WA', 'OR', 'NV', 'AZ', 'CO', 'NM', 'UT', 'ID', 'MT'];
    const CENTRAL = ['TX', 'OK', 'KS', 'MO', 'IL', 'WI', 'MN', 'IA', 'NE', 'LA', 'AR'];
    const bandFor = state => WEST.includes(state) ? 'US Pacific'
      : CENTRAL.includes(state) ? 'US Central / Mountain' : 'US Eastern';

    const updates = [];
    let noViableMatch = 0;
    const scores = [];

    for (const d of active) {
      const p = d.properties;
      const co = coById.get(String((dealCompany.get(String(d.id)) || [])[0]));
      const sector = co ? co.properties.zia_industry : null;
      const wantBand = co ? bandFor(co.properties.state) : null;
      const lines = multi(p.zia_service_type);
      const hours = +p.zia_hours_per_week || 0;
      const needsSenior = p.zia_deal_type === 'summit';

      const ranked = [];
      for (const c of talent) {
        const t = c.properties;
        // ---- hard filters ----
        if (t.zia_compliance_status !== 'clear') continue;
        if ((load.get(t.email) || 0) + hours > MAX_HOURS) continue;
        if (needsSenior && !SENIOR.includes(t.zia_seniority)) continue;

        const sectors = multi(t.zia_sector_expertise);
        const canDeliver = multi(t.zia_service_lines);

        let s = 0;
        if (sector && sectors.includes(sector)) s += W.sector;
        if (lines.length) {
          const hit = lines.filter(l => canDeliver.includes(l)).length;
          s += W.line * (hit / lines.length);
        } else s += W.line * 0.5;                       // nothing specified — neutral
        const rec = +t.zia_avg_delivered_health;
        s += W.record * (isNaN(rec) ? 0.5 : Math.max(0, Math.min(1, rec / 100)));
        if (wantBand && t.zia_coverage_band === wantBand) s += W.coverage;
        else if (t.zia_coverage_band === 'Overnight / Overflow') s += W.coverage * 0.4;
        const free = MAX_HOURS - (load.get(t.email) || 0);
        s += W.capacity * Math.max(0, Math.min(1, free / MAX_HOURS));

        ranked.push({ c, s: Math.round(s), sectorHit: sector && sectors.includes(sector) });
      }

      ranked.sort((a, b) => b.s - a.s);
      const top = ranked.slice(0, 3);
      if (!top.length) { noViableMatch++; continue; }
      scores.push(top[0].s);

      const shortlist = top.map(r => {
        const t = r.c.properties;
        const why = [
          r.sectorHit ? `${sector} experience` : 'no sector match',
          `${t.zia_seniority || 'grade n/a'}`,
          t.zia_avg_delivered_health ? `health ${t.zia_avg_delivered_health}` : 'no track record',
          `${MAX_HOURS - (load.get(t.email) || 0)}h free`,
        ].join(' · ');
        return `${r.s}/100  ${t.firstname} ${t.lastname} — ${why}`;
      }).join('\n');

      const best = top[0].s;
      if (p.zia_match_shortlist !== shortlist || String(p.zia_match_best_score ?? '') !== String(best)) {
        updates.push({ id: d.id, properties: { zia_match_shortlist: shortlist, zia_match_best_score: best } });
      }
    }

    const weak = scores.filter(s => s < 50).length;
    const result = {
      matched: active.length,
      noViableMatch,
      weakBest: weak,
      avgBestScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    };

    if (dryRun) return { ...result, wouldWrite: updates.length };
    const r = await batch('deals', 'update', updates);
    return { ...result, shortlisted: r.ok, failed: r.failed };
  },
};
