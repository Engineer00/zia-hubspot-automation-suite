#!/usr/bin/env node
'use strict';
/**
 * P18 — rate card repricing.
 *
 * THE DEFECT
 * The portal still prices work like the offshore clinical-admin staffing business it
 * was before the P0 reskin: consultants bill **$12-22/hour** and cost **$5-12/hour**.
 * An organizational-development consultant does not bill $16/hour. The giveaway is
 * revenue per placed consultant: **$50,640/year**, roughly a fifth of what a real
 * delivery consultant generates.
 *
 * WHAT SETS THE CEILING
 * Hours are staying at ~39/week (an embedded delivery model), so the rate cannot be a
 * partner-level coaching rate — 39 hrs/wk at $300/hr implies $600k per consultant per
 * year, which is not a real number either. The honest target is a **blended delivery
 * rate**: enough to produce $180k-250k of revenue per placed consultant per year,
 * which is what a mid-market consultancy actually books.
 *
 *   Core      $85/hr   ->  ~$172k per consultant per year
 *   Momentum  $110/hr  ->  ~$223k
 *   Summit    $145/hr  ->  ~$294k
 *
 * Cost rate is set at ~55% of bill, a normal services gross margin.
 *
 * PROGRAMME PRICING MOVES WITH IT
 * Acquisition deals sell the programmes that delivery then executes. Repricing one
 * side and not the other would leave the business selling $30k of work and delivering
 * $300k of it. Programme products are scaled by the same factor so both halves of the
 * two-sided model stay in proportion.
 *
 * COUPLING — the reason this pass is not a one-liner
 * Deal amount is bound to the sum of its line items (enforced by P16). Repricing
 * therefore has to move, in order: product prices -> line-item price and amount ->
 * deal amount. Miss the last step and every deal contradicts its own products again.
 *
 *   node realism/p18-rate-card.js            dry run
 *   node realism/p18-rate-card.js --apply    write it
 */
const { api, listAll, batch, readAssociations } = require('../lib/hubspot');

const APPLY = process.argv.includes('--apply');
const money = n => '$' + Math.round(n).toLocaleString('en-US');

// New bill rates per tier. Cost is 55% of bill.
const BILL = { core: 85, momentum: 110, summit: 145 };
const COST_RATIO = 0.55;

// Hourly SKUs carry the bill rate directly.
const HOURLY_SKU = { 'ZIA-HR-CORE': BILL.core, 'ZIA-HR-MOM': BILL.momentum, 'ZIA-HR-SUM': BILL.summit };

// Programme SKUs scale by the same factor the hourly rates moved, so the sell side and
// the delivery side stay in proportion. Old prices: 1850 / 2650 / 3900 / 950.
const PROGRAMME_FACTOR = BILL.momentum / 16;          // momentum was the $16 median
const PROGRAMME_SKU = ['ZIA-EMB-CORE', 'ZIA-EMB-MOM', 'ZIA-EMB-SUM', 'ZIA-ONB'];

const round5 = n => Math.round(n / 5) * 5;

(async () => {
  console.log('pulling products, line items and deals...');
  const products = await listAll('products', ['name', 'hs_sku', 'price']);
  const lineItems = await listAll('line_items', ['name', 'hs_sku', 'price', 'quantity', 'amount', 'hs_discount_percentage']);
  const deals = await listAll('deals', ['dealname', 'amount', 'zia_deal_type', 'zia_placement_status', 'zia_hourly_rate']);
  const contacts = await listAll('contacts', ['zia_contact_type', 'zia_tier', 'zia_cost_rate']);

  // ---- 1. products -------------------------------------------------------
  const newPrice = new Map();
  const productUpdates = [];
  for (const p of products) {
    const sku = p.properties.hs_sku;
    const old = +p.properties.price || 0;
    let next = null;
    if (HOURLY_SKU[sku] !== undefined) next = HOURLY_SKU[sku];
    else if (PROGRAMME_SKU.includes(sku)) next = round5(old * PROGRAMME_FACTOR);
    if (next === null || next === old) continue;
    newPrice.set(sku, next);
    productUpdates.push({ id: p.id, properties: { price: String(next) }, __sku: sku, __old: old, __new: next });
  }

  console.log('\nproduct rate card:');
  for (const u of productUpdates) {
    console.log(`  ${u.__sku.padEnd(14)} ${money(u.__old).padStart(8)}  ->  ${money(u.__new)}`);
  }

  // ---- 2. line items -----------------------------------------------------
  const lineUpdates = [];
  const newLineAmount = new Map();
  for (const l of lineItems) {
    const sku = l.properties.hs_sku;
    const price = newPrice.get(sku);
    if (price === undefined) continue;
    const qty = +l.properties.quantity || 0;
    const disc = +l.properties.hs_discount_percentage || 0;
    const amount = Math.round(price * qty * (1 - disc / 100) * 100) / 100;
    newLineAmount.set(String(l.id), amount);
    lineUpdates.push({ id: l.id, properties: { price: String(price), amount: String(amount) } });
  }

  // ---- 3. deal amounts, rebuilt from the new line-item totals -------------
  const ld = await readAssociations('line_items', 'deals', lineItems.map(l => l.id));
  const dealTotal = new Map();
  for (const l of lineItems) {
    const amt = newLineAmount.has(String(l.id)) ? newLineAmount.get(String(l.id)) : (+l.properties.amount || 0);
    for (const dealId of ld.get(String(l.id)) || []) {
      dealTotal.set(dealId, (dealTotal.get(dealId) || 0) + amt);
    }
  }

  const seeded = deals.filter(d => d.properties.zia_deal_type);
  const dealUpdates = [];
  let wonBefore = 0, wonAfter = 0;
  for (const d of seeded) {
    const t = dealTotal.get(String(d.id));
    if (t === undefined) continue;
    const corrected = Math.round(t * 100) / 100;
    if (Math.abs((+d.properties.amount || 0) - corrected) >= 0.01) {
      dealUpdates.push({ id: d.id, properties: { amount: String(corrected) } });
    }
  }
  for (const d of seeded) {
    wonBefore += +d.properties.amount || 0;
    wonAfter += dealTotal.has(String(d.id)) ? dealTotal.get(String(d.id)) : (+d.properties.amount || 0);
  }

  // ---- 4. hourly rate on placements, cost rate on consultants -------------
  const TIER_OF_RATE = { 12: 'core', 16: 'momentum', 22: 'summit' };
  const rateUpdates = [];
  for (const d of seeded) {
    if (!d.properties.zia_placement_status) continue;
    const old = +d.properties.zia_hourly_rate || 0;
    const tier = TIER_OF_RATE[old];
    if (!tier) continue;
    rateUpdates.push({ id: d.id, properties: { zia_hourly_rate: String(BILL[tier]) } });
  }

  const costUpdates = [];
  for (const c of contacts) {
    if (c.properties.zia_contact_type !== 'talent') continue;
    const tier = c.properties.zia_tier;
    if (!BILL[tier]) continue;
    const cost = Math.round(BILL[tier] * COST_RATIO);
    if (String(cost) === String(Math.round(+c.properties.zia_cost_rate || 0))) continue;
    costUpdates.push({ id: c.id, properties: { zia_cost_rate: String(cost) } });
  }

  console.log(`\nto write:  ${productUpdates.length} products · ${lineUpdates.length} line items`
    + ` · ${dealUpdates.length} deal amounts · ${rateUpdates.length} bill rates · ${costUpdates.length} cost rates`);
  console.log(`total seeded deal value  ${money(wonBefore)}  ->  ${money(wonAfter)}`
    + `   (x${(wonAfter / wonBefore).toFixed(2)})`);

  const placedHours = 9495;   // active weekly hours, from the live snapshot
  console.log(`revenue per placed consultant (156 placed): `
    + `${money(placedHours * 52 * BILL.momentum / 156)}/yr at the Momentum rate`);

  if (!APPLY) { console.log('\ndry run — re-run with --apply to write.'); return; }

  for (const [label, object, rows] of [
    ['products', 'products', productUpdates.map(({ id, properties }) => ({ id, properties }))],
    ['line items', 'line_items', lineUpdates],
    ['deal amounts', 'deals', dealUpdates],
    ['bill rates', 'deals', rateUpdates],
    ['cost rates', 'contacts', costUpdates],
  ]) {
    if (!rows.length) { console.log(`  ${label}: nothing to write`); continue; }
    const r = await batch(object, 'update', rows);
    console.log(`  ${label.padEnd(14)} ok ${r.ok}  failed ${r.failed}`);
  }
  console.log('\nRemember: node snapshot.js && node build-dashboard.js && node validate.js');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
