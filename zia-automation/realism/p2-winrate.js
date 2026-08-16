'use strict';
/**
 * P2 — realistic win rate.
 *
 * Today: 317 won / 203 lost / 480 open on acquisition = 61% win on closed deals,
 * and 80% portal-wide once the 500 delivered placements are counted.
 * Real B2B professional services closes 20-35%.
 *
 * Target on the 1,000 acquisition deals:
 *   ~70% closed (30% of those won -> ~210 won, ~490 lost)
 *   ~30% still open, weighted toward the top of the funnel
 *
 * Placements stay Closed Won — they are delivered revenue, not sales attempts.
 * The dashboard reports acquisition win rate separately, which is the honest number.
 */
const { listAll, batch, STAGE } = require('../lib/hubspot');
const { rng, weighted } = require('./lib');

const TARGET_WIN = 0.30;
const TARGET_OPEN = 0.30;

module.exports = async function p2({ dryRun }) {
  const deals = await listAll('deals', ['dealname', 'dealstage', 'zia_deal_type', 'zia_placement_status', 'closedate', 'amount']);
  const acq = deals.filter(d => d.properties.zia_deal_type && !d.properties.zia_placement_status);
  console.log(`  acquisition deals: ${acq.length}`);

  const before = {};
  for (const d of acq) before[d.properties.dealstage] = (before[d.properties.dealstage] || 0) + 1;

  const updates = [];
  const after = {};
  for (const d of acq) {
    const r = rng('stage:' + d.id);
    const roll = r();
    let stage;
    if (roll < TARGET_OPEN) {
      // still open — real pipelines are fat at the top
      stage = weighted(r, [
        [STAGE.LEAD, 40], [STAGE.QUALIFIED, 28], [STAGE.PROPOSAL, 20], [STAGE.NEGOTIATION, 12],
      ]);
    } else {
      stage = r() < TARGET_WIN ? STAGE.WON : STAGE.LOST;
    }
    after[stage] = (after[stage] || 0) + 1;
    if (stage !== d.properties.dealstage) updates.push({ id: d.id, properties: { dealstage: stage } });
  }

  console.log(`  stage changes: ${updates.length}`);
  const res = await batch('deals', 'update', updates, { dryRun });

  const wonA = after[STAGE.WON] || 0, lostA = after[STAGE.LOST] || 0;
  console.log(`  new acquisition win rate: ${(wonA / (wonA + lostA) * 100).toFixed(1)}%  (${wonA} won / ${lostA} lost)`);
  console.log(`  open: ${acq.length - wonA - lostA}`);

  return { changed: res.ok, failed: res.failed, wouldWrite: res.wouldWrite, before, after };
};
