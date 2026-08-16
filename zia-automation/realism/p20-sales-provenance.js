#!/usr/bin/env node
'use strict';
/**
 * P20 — sales provenance for delivery engagements.
 *
 * THE DEFECT
 * 72 client organizations hold delivery engagements with **no won sale behind them** —
 * 153 engagements being executed against nothing. The seed generated acquisition deals
 * and delivery engagements independently, so the two halves of a two-sided business
 * never joined up.
 *
 * It is the kind of gap that survives every cosmetic pass and then collapses the story
 * the moment someone asks "so where did this engagement come from?"
 *
 * THE FIX
 * For each such organization, create the won acquisition deal that sold the work:
 * priced from the programme catalogue at the right tier, closed shortly BEFORE the
 * earliest engagement started, and associated to the same company. The funnel then
 * reads the way a real one does — every delivery traces back to a sale.
 *
 *   node realism/p20-sales-provenance.js            dry run
 *   node realism/p20-sales-provenance.js --apply    create the missing sales
 */
const { api, listAll, batch, readAssociations, STAGE, ASSOC } = require('../lib/hubspot');

const APPLY = process.argv.includes('--apply');
const DAY = 864e5;
const money = n => '$' + Math.round(n).toLocaleString('en-US');

// Programme list price per tier, matching the repriced catalogue (P18).
const PROGRAMME = { core: 12720, momentum: 18220, summit: 26815 };
const SERVICE = ['Leadership Development', 'Executive Coaching', 'Team Effectiveness',
  'Change Management', 'Succession Planning', 'Culture & Engagement',
  'Organizational Design', 'Performance Consulting'];
const SOURCE = ['referral', 'website_organic', 'inbound_enquiry', 'event_conference', 'outbound'];

const seeded = id => {
  let h = 2166136261;
  for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
};
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

(async () => {
  console.log('pulling deals and companies...');
  const deals = await listAll('deals', ['dealname', 'amount', 'dealstage', 'zia_deal_type',
    'zia_placement_status', 'zia_embed_start_date', 'closedate', 'createdate']);
  const companies = await listAll('companies', ['name', 'domain']);
  const coById = new Map(companies.map(c => [String(c.id), c]));
  const s = deals.filter(d => d.properties.zia_deal_type);
  const dc = await readAssociations('deals', 'companies', s.map(d => d.id));

  const byCo = new Map();
  for (const d of s) {
    for (const co of dc.get(String(d.id)) || []) {
      const e = byCo.get(co) || { won: 0, delivery: [], tiers: {} };
      if (d.properties.zia_placement_status) {
        e.delivery.push(d);
        const t = d.properties.zia_deal_type;
        e.tiers[t] = (e.tiers[t] || 0) + 1;
      } else if (d.properties.dealstage === STAGE.WON) e.won++;
      byCo.set(co, e);
    }
  }

  const needs = [];
  for (const [co, e] of byCo) {
    if (e.delivery.length && !e.won) needs.push({ co, e });
  }
  console.log(`organizations delivering with no won sale: ${needs.length}`
    + `  (${needs.reduce((a, n) => a + n.e.delivery.length, 0)} engagements)`);
  if (!needs.length) { console.log('nothing to do'); return; }

  const creates = [];
  for (const { co, e } of needs) {
    const company = coById.get(String(co));
    if (!company) continue;
    const rnd = seeded(co);

    // Dominant tier across that company's engagements decides the programme sold.
    const tier = Object.entries(e.tiers).sort((a, b) => b[1] - a[1])[0][0];
    const unit = PROGRAMME[tier] || PROGRAMME.momentum;
    const teams = 1 + Math.floor(rnd() * 3);
    const amount = Math.round(unit * teams * (1 - (rnd() < 0.4 ? [0.05, 0.1, 0.15][Math.floor(rnd() * 3)] : 0)) * 100) / 100;

    // Sold before the work started.
    const starts = e.delivery.map(d => d.properties.zia_embed_start_date).filter(Boolean).sort();
    const earliest = starts.length ? new Date(starts[0]).getTime() : Date.now() - 200 * DAY;
    const close = earliest - (7 + Math.floor(rnd() * 30)) * DAY;
    const created = close - (20 + Math.floor(rnd() * 110)) * DAY;

    creates.push({
      __company: co,
      properties: {
        dealname: `${company.properties.name} — ${tier[0].toUpperCase() + tier.slice(1)} program`,
        amount: String(amount),
        dealstage: STAGE.WON,
        pipeline: 'default',
        closedate: new Date(close).toISOString().slice(0, 10),
        createdate: new Date(created).toISOString(),
        zia_deal_type: tier,
        zia_service_type: pick(rnd, SERVICE),
        zia_first_touch_source: pick(rnd, SOURCE),
        zia_seats_committed: String(teams * (4 + Math.floor(rnd() * 8))),
      },
    });
  }

  const total = creates.reduce((a, c) => a + (+c.properties.amount), 0);
  console.log(`\nwould create ${creates.length} won acquisition deals worth ${money(total)}`);
  console.log('samples:');
  for (const c of creates.slice(0, 6)) {
    console.log(`  ${c.properties.dealname.padEnd(48)} ${money(+c.properties.amount).padStart(10)}  closed ${c.properties.closedate}`);
  }

  if (!APPLY) { console.log('\ndry run — re-run with --apply to create.'); return; }

  const r = await api('POST', '/crm/v3/objects/deals/batch/create',
    { inputs: creates.map(({ properties }) => ({ properties })) });
  const made = r.results || [];
  console.log(`\ncreated ${made.length} deals`);

  // Associate each new deal to its company (primary).
  const assoc = made.map((d, i) => ({
    from: { id: d.id },
    to: { id: String(creates[i].__company) },
    types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.DEAL_TO_COMPANY }],
  }));
  for (let i = 0; i < assoc.length; i += 100) {
    await api('POST', '/crm/v4/associations/deals/companies/batch/create', { inputs: assoc.slice(i, i + 100) });
  }
  console.log(`associated ${assoc.length} deals to their company`);
  console.log('\nRemember: node engine.js && node snapshot.js && node build-dashboard.js && node validate.js');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
