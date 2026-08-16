'use strict';
/**
 * P14 — seed the feedback data an NPS programme would collect.
 *
 * HubSpot's Feedback Surveys (NPS, CSAT, CES) are Service Hub Professional, and the
 * feedback_submissions object is scope-blocked here besides. So feedback is modelled
 * as what it actually is: a score, a date, a verbatim, and a rollup — none of which
 * require a survey product.
 *
 * This script seeds the responses. WF-10 does the ongoing work: categorising,
 * rolling up to the account, and raising a ticket for every detractor.
 *
 * REALISM
 * Scores are correlated with the delivery health of that client's engagements, with
 * noise — because in a real business NPS and delivery quality are related but not
 * identical, and the interesting cases are exactly where they disagree.
 *
 * A ~42% response rate is applied, which is high for NPS but normal for a
 * relationship survey sent to a named client contact.
 *
 *   node realism/p14-nps.js --dry-run
 *   node realism/p14-nps.js
 */
const { api, listAll, batch, readAssociations } = require('../lib/hubspot');
const { rng, clamp } = require('./lib');

const CONTACT_PROPS = [
  { name: 'zia_nps_score', label: 'NPS Score', type: 'number', fieldType: 'number',
    description: '0-10 likelihood to recommend. Seeded by P14, categorised by WF-10.' },
  { name: 'zia_nps_category', label: 'NPS Category', type: 'enumeration', fieldType: 'select',
    description: 'Promoter 9-10, Passive 7-8, Detractor 0-6. Computed by WF-10.',
    options: [['promoter', 'Promoter'], ['passive', 'Passive'], ['detractor', 'Detractor']]
      .map(([value, label], i) => ({ label, value, displayOrder: i, hidden: false })) },
  { name: 'zia_nps_date', label: 'NPS Response Date', type: 'date', fieldType: 'date',
    description: 'When the respondent last answered.' },
  { name: 'zia_nps_comment', label: 'NPS Comment', type: 'string', fieldType: 'textarea',
    description: 'Verbatim feedback. The part people actually read.' },
];

const COMPANY_PROPS = [
  { name: 'zia_nps_avg', label: 'Account NPS', type: 'number', fieldType: 'number',
    description: 'Net Promoter Score for the account: %promoters - %detractors. Rolled up by WF-10.' },
  { name: 'zia_nps_responses', label: 'NPS Responses', type: 'number', fieldType: 'number',
    description: 'How many contacts at this account have responded.' },
];

/** Verbatims keyed to score band — what people actually write. */
const COMMENTS = {
  promoter: [
    'The consultant embedded quickly and our managers now run their own retros.',
    'Best development programme we have run. Measurable change in how the team escalates.',
    'Genuinely useful. The 1:1 coaching was the part that moved the needle.',
    'Would recommend without hesitation — they adapted the programme to our context.',
  ],
  passive: [
    'Solid delivery, though scheduling was harder than it needed to be.',
    'Good content. I would have liked clearer measurement of the outcome.',
    'Useful, but the pace did not suit everyone in the cohort.',
    'Fine. Nothing went wrong, nothing was remarkable.',
  ],
  detractor: [
    'Sessions were rescheduled repeatedly and we lost momentum.',
    'The objectives were never re-baselined after our sponsor changed.',
    'Hard to see what we got for the spend. No measurable outcome was agreed.',
    'Consultant did not seem briefed on our sector. We spent sessions explaining ourselves.',
    'Attendance dropped and nobody from ZIA raised it with us.',
  ],
};

const categoryOf = s => s >= 9 ? 'promoter' : s >= 7 ? 'passive' : 'detractor';

async function ensure(object, props) {
  for (const p of props) {
    try {
      await api('POST', `/crm/v3/properties/${object}`, {
        ...p, groupName: object === 'contacts' ? 'contactinformation' : 'companyinformation',
      });
      console.log(`  created ${object}.${p.name}`);
    } catch (e) {
      if (!String(e.message).includes('already exists')) throw e;
      if (p.options) await api('PATCH', `/crm/v3/properties/${object}/${p.name}`, { options: p.options });
    }
  }
}

module.exports = async function p14({ dryRun }) {
  if (!dryRun) {
    await ensure('contacts', CONTACT_PROPS);
    await ensure('companies', COMPANY_PROPS);
  }

  const contacts = await listAll('contacts', ['email', 'zia_contact_type', 'zia_nps_score']);
  const clients = contacts.filter(c => c.properties.zia_contact_type === 'client_contact');
  const unanswered = clients.filter(c => c.properties.zia_nps_score === null
    || c.properties.zia_nps_score === undefined || c.properties.zia_nps_score === '');

  console.log(`  client contacts: ${clients.length}, without a response: ${unanswered.length}`);
  if (!unanswered.length) return { ok: true, seeded: 0, note: 'every client contact already has a response' };

  // ---- health of each client's engagements, to correlate against ----
  const deals = await listAll('deals', ['zia_health_score', 'zia_placement_status']);
  const placements = deals.filter(d => d.properties.zia_placement_status);
  const dealCompany = await readAssociations('deals', 'companies', placements.map(d => d.id));

  const healthByCompany = new Map();
  for (const p of placements) {
    for (const co of dealCompany.get(String(p.id)) || []) {
      const arr = healthByCompany.get(co) || [];
      arr.push(+p.properties.zia_health_score || 0);
      healthByCompany.set(co, arr);
    }
  }

  const contactCompany = await readAssociations('contacts', 'companies', unanswered.map(c => c.id));

  const updates = [];
  const dist = { promoter: 0, passive: 0, detractor: 0 };

  for (const c of unanswered) {
    const r = rng('nps' + c.id);
    if (r() > 0.42) continue;                      // response rate

    const co = (contactCompany.get(String(c.id)) || [])[0];
    const health = healthByCompany.get(co);
    const avgHealth = health && health.length
      ? health.reduce((a, b) => a + b, 0) / health.length
      : 68;                                        // no engagement yet — use portal average

    // Calibration: a first attempt mapped health/10 directly onto the 0-10 scale and
    // produced NPS -44, with 140 detractors to 24 promoters. That is a company in
    // freefall, not one running 340 live engagements — the error was treating the NPS
    // scale as linear when its bands are not: 0-6 is ALL detractor, so centring near 6
    // makes almost everyone one.
    //
    // Centre on 8.4 instead (upper passive), and let health move it. An account
    // averaging 68 health lands passive; 90 lands promoter; 40 lands detractor.
    const base = 8.4 + (avgHealth - 68) / 11;
    const noise = (r() - 0.5) * 3.2;
    const score = Math.round(clamp(base + noise, 0, 10));
    const category = categoryOf(score);
    dist[category]++;

    const pool = COMMENTS[category];
    const daysAgo = Math.floor(r() * 240);
    const when = new Date(Date.now() - daysAgo * 864e5);

    updates.push({
      id: c.id,
      properties: {
        zia_nps_score: score,
        zia_nps_category: category,
        zia_nps_date: Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()),
        zia_nps_comment: pool[Math.floor(r() * pool.length)],
      },
    });
  }

  const promoters = dist.promoter, detractors = dist.detractor;
  const total = updates.length;
  const nps = total ? Math.round(((promoters - detractors) / total) * 100) : 0;

  console.log(`  responses: ${total}  promoters ${promoters}  passives ${dist.passive}  detractors ${detractors}`);
  console.log(`  NPS = ${nps}`);

  if (dryRun) return { ok: true, dryRun: true, wouldWrite: total, dist, nps };

  const r = await batch('contacts', 'update', updates);
  return { ok: true, seeded: r.ok, failed: r.failed, dist, nps };
};

if (require.main === module) {
  module.exports({ dryRun: process.argv.includes('--dry-run') })
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error(e); process.exit(1); });
}
