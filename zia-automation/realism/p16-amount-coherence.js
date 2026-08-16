#!/usr/bin/env node
'use strict';
/**
 * P16 — deal amount / line-item coherence.
 *
 * THE DEFECT
 * A deal that carries line items should be worth what its line items add up to.
 * 93 deals here were given a second line item after the amount was set, and the
 * amount was never recalculated — so the deal header and the products tab on the
 * same record disagree, sometimes by a factor of two ($16,960 against $31,924).
 *
 * That is the sort of inconsistency a reviewer finds by opening one record, and it
 * undermines every revenue figure on the dashboard at the same time.
 *
 * WHY NOT ROUND THE AMOUNTS INSTEAD
 * The amounts look "computed" rather than negotiated — $23,777 rather than $24,000 —
 * and the first instinct is to round them. That instinct is wrong here. These deals
 * are priced from a product catalogue with percentage discounts, which is exactly how
 * HubSpot quotes work: 9 teams at $2,650 less 15% is $20,272.50. Non-round totals are
 * the CORRECT output of that model. Rounding them would break the very coupling this
 * pass exists to restore.
 *
 *   node realism/p16-amount-coherence.js            dry run — shows the delta
 *   node realism/p16-amount-coherence.js --apply    write the corrected amounts
 */
const { listAll, readAssociations, batch, STAGE } = require('../lib/hubspot');

const APPLY = process.argv.includes('--apply');
const money = n => '$' + Math.round(n).toLocaleString('en-US');

(async () => {
  console.log('pulling deals and line items...');
  const deals = await listAll('deals', ['dealname', 'amount', 'dealstage', 'zia_deal_type', 'zia_placement_status']);
  const seeded = deals.filter(d => d.properties.zia_deal_type);

  const lineItems = await listAll('line_items', ['amount', 'name']);
  const ld = await readAssociations('line_items', 'deals', lineItems.map(l => l.id));

  const total = new Map(), count = new Map();
  for (const l of lineItems) {
    for (const dealId of ld.get(String(l.id)) || []) {
      total.set(dealId, (total.get(dealId) || 0) + (+l.properties.amount || 0));
      count.set(dealId, (count.get(dealId) || 0) + 1);
    }
  }

  const updates = [];
  let wonBefore = 0, wonAfter = 0;
  for (const d of seeded) {
    const sum = total.get(String(d.id));
    const amount = +d.properties.amount || 0;
    const isWon = d.properties.dealstage === STAGE.WON;
    if (isWon) wonBefore += amount;

    if (sum === undefined) { if (isWon) wonAfter += amount; continue; }

    // HubSpot stores currency to 2dp; anything under a cent is not a disagreement.
    const corrected = Math.round(sum * 100) / 100;
    if (Math.abs(amount - corrected) >= 0.01) {
      updates.push({
        id: d.id,
        properties: { amount: String(corrected) },
        __was: amount, __now: corrected, __items: count.get(String(d.id)),
      });
      if (isWon) wonAfter += corrected;
    } else if (isWon) wonAfter += amount;
  }

  const bigger = updates.filter(u => u.__now > u.__was).length;
  console.log(`\ndeals to correct: ${updates.length}`
    + `   (${bigger} understated, ${updates.length - bigger} overstated)`);
  console.log('\nworst disagreements:');
  for (const u of [...updates].sort((a, b) => Math.abs(b.__now - b.__was) - Math.abs(a.__now - a.__was)).slice(0, 8)) {
    console.log(`  ${u.__items} line items   header ${money(u.__was).padStart(10)}  ->  items ${money(u.__now)}`);
  }

  console.log(`\nclosed-won total   before ${money(wonBefore)}   after ${money(wonAfter)}`
    + `   delta ${money(wonAfter - wonBefore)}`);

  if (!APPLY) { console.log('\ndry run — re-run with --apply to write.'); return; }

  const r = await batch('deals', 'update', updates.map(({ id, properties }) => ({ id, properties })));
  console.log(`\ncorrected ${r.ok}   failed ${r.failed}`);
  console.log('Remember: node snapshot.js && node build-dashboard.js && node validate.js');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
