#!/usr/bin/env node
'use strict';
/**
 * P21 — restore a believable win rate.
 *
 * WHY
 * P20 gave every delivery engagement the sale it was missing, which was correct — but
 * it only added *wins*. The acquisition win rate jumped to 50.2% (112 won / 111 lost).
 * No professional-services firm wins half its new business; the real range is 20-35%,
 * and the whole "blended win rate is a reporting trap" finding depends on the honest
 * number being ~30%.
 *
 * A won deal implies the losses that came with it. This pass creates the pursuits that
 * did not land, so the funnel reads the way a real pipeline does.
 *
 * WHERE THEY GO
 * Losses are spread across organizations that already exist — clients lose follow-on
 * bids too, not just prospects — with recorded loss reasons drawn from the same
 * vocabulary the dashboard already reports on.
 *
 *   node realism/p21-loss-balance.js                dry run
 *   node realism/p21-loss-balance.js --apply        create the lost deals
 *   node realism/p21-loss-balance.js --rate 0.30    target a different win rate
 */
const { api, listAll, readAssociations, STAGE, ASSOC } = require('../lib/hubspot');

const APPLY = process.argv.includes('--apply');
const rIdx = process.argv.indexOf('--rate');
const TARGET_RATE = rIdx > -1 ? +process.argv[rIdx + 1] : 0.30;
const DAY = 864e5;

const LOSS_REASONS = ['Specialty experience', 'Client paused decision', 'Learning platform gap',
  'Rate', 'Communication style', 'Coverage hours mismatch'];
const SERVICE = ['Leadership Development', 'Executive Coaching', 'Team Effectiveness',
  'Change Management', 'Succession Planning', 'Culture & Engagement',
  'Organizational Design', 'Performance Consulting'];
const SOURCE = ['referral', 'website_organic', 'inbound_enquiry', 'event_conference', 'outbound', 'linkedin'];
const PROGRAMME = { core: 12720, momentum: 18220, summit: 26815 };
const TIERS = ['core', 'momentum', 'summit'];

const seeded = seed => {
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
};
const pick = (rnd, a) => a[Math.floor(rnd() * a.length)];

(async () => {
  const deals = await listAll('deals', ['dealstage', 'zia_deal_type', 'zia_placement_status', 'closedate']);
  const companies = await listAll('companies', ['name', 'domain']);
  const s = deals.filter(d => d.properties.zia_deal_type);
  const acq = s.filter(d => !d.properties.zia_placement_status);
  const won = acq.filter(d => d.properties.dealstage === STAGE.WON).length;
  const lost = acq.filter(d => d.properties.dealstage === STAGE.LOST).length;

  const currentRate = won / (won + lost);
  // won / (won + lost + N) = target  ->  N = won/target - won - lost
  const need = Math.max(0, Math.round(won / TARGET_RATE - won - lost));

  console.log(`acquisition today : ${won} won / ${lost} lost  = ${(currentRate * 100).toFixed(1)}% win rate`);
  console.log(`target            : ${(TARGET_RATE * 100).toFixed(0)}%  ->  create ${need} lost pursuits`);
  if (!need) { console.log('already at target'); return; }

  // Spread across every organization except the ZIA operating company.
  const targets = companies.filter(c => !/^ZIA\b/i.test(c.properties.name || ''));
  const closeDates = acq.map(d => d.properties.closedate).filter(Boolean).sort();
  const first = new Date(closeDates[0] || Date.now() - 600 * DAY).getTime();
  const last = new Date(closeDates[closeDates.length - 1] || Date.now()).getTime();

  const creates = [];
  for (let i = 0; i < need; i++) {
    const company = targets[i % targets.length];
    const rnd = seeded(`${company.id}-loss-${i}`);
    const tier = pick(rnd, TIERS);
    const teams = 1 + Math.floor(rnd() * 3);
    const amount = Math.round(PROGRAMME[tier] * teams * 100) / 100;
    const close = first + rnd() * (last - first);
    const created = close - (25 + Math.floor(rnd() * 120)) * DAY;
    creates.push({
      __company: String(company.id),
      properties: {
        dealname: `${company.properties.name} — ${tier[0].toUpperCase() + tier.slice(1)} program`,
        amount: String(amount),
        dealstage: STAGE.LOST,
        pipeline: 'default',
        closedate: new Date(close).toISOString().slice(0, 10),
        createdate: new Date(created).toISOString(),
        zia_deal_type: tier,
        zia_service_type: pick(rnd, SERVICE),
        zia_first_touch_source: pick(rnd, SOURCE),
        zia_primary_challenge: pick(rnd, LOSS_REASONS),
      },
    });
  }

  const projected = won / (won + lost + creates.length);
  console.log(`\nprojected win rate after: ${(projected * 100).toFixed(1)}%`);
  console.log(`total lost value added : $${Math.round(creates.reduce((a, c) => a + +c.properties.amount, 0)).toLocaleString()}`);
  console.log('samples:');
  for (const c of creates.slice(0, 5)) {
    console.log(`  ${c.properties.dealname.padEnd(46)} ${c.properties.closedate}  ${c.properties.zia_primary_challenge}`);
  }

  if (!APPLY) { console.log('\ndry run — re-run with --apply.'); return; }

  const made = [];
  for (let i = 0; i < creates.length; i += 100) {
    const chunk = creates.slice(i, i + 100);
    const r = await api('POST', '/crm/v3/objects/deals/batch/create',
      { inputs: chunk.map(({ properties }) => ({ properties })) });
    (r.results || []).forEach((d, j) => made.push({ id: d.id, company: chunk[j].__company }));
  }
  console.log(`\ncreated ${made.length} lost deals`);

  const assoc = made.map(m => ({
    from: { id: m.id }, to: { id: m.company },
    types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.DEAL_TO_COMPANY }],
  }));
  for (let i = 0; i < assoc.length; i += 100) {
    await api('POST', '/crm/v4/associations/deals/companies/batch/create', { inputs: assoc.slice(i, i + 100) });
  }
  console.log(`associated ${assoc.length} to their company`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
