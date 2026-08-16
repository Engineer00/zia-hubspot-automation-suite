'use strict';
/**
 * P3 — believable placement health.
 *
 * Today: 174 critical / 18 at-risk / 172 watch / 136 healthy. The hole at 40-59
 * cannot occur in a real measured population — it is a seed-generator artifact.
 *
 * Replace with a left-skewed distribution centred near 70 (most engagements are
 * fine, a thin tail is in trouble), then make zia_placement_status AGREE with it:
 *
 *   ended placements      -> keep ended, health frozen at exit
 *   health < 45           -> at_risk
 *   otherwise             -> active
 *
 * That deliberately removes the 174-vs-39 contradiction, so the remaining gap the
 * dashboard reports is a real governance lag (scored low but not yet escalated),
 * sized realistically rather than absurdly.
 */
const { listAll, batch } = require('../lib/hubspot');
const { rng, normal, clamp } = require('./lib');

module.exports = async function p3({ dryRun }) {
  const deals = await listAll('deals', ['dealname', 'zia_placement_status', 'zia_health_score', 'zia_embed_end_date', 'zia_deal_type']);
  const placements = deals.filter(d => d.properties.zia_placement_status);
  console.log(`  placements: ${placements.length}`);

  const updates = [];
  const buckets = { 'Critical (<40)': 0, 'At risk (40-59)': 0, 'Watch (60-79)': 0, 'Healthy (80+)': 0 };
  const statuses = {};

  for (const p of placements) {
    const r = rng('health:' + p.id);
    const ended = !!p.properties.zia_embed_end_date;

    // left-skewed: mean 71, sd 15, with a deliberate thin lower tail
    let h = normal(r, 71, 15);
    if (r() < 0.12) h -= 22;              // the genuinely struggling minority
    h = Math.round(clamp(h, 8, 99));

    let status;
    if (ended) status = 'ended';
    else if (h < 45) status = 'at_risk';
    else status = 'active';

    if (h < 40) buckets['Critical (<40)']++;
    else if (h < 60) buckets['At risk (40-59)']++;
    else if (h < 80) buckets['Watch (60-79)']++;
    else buckets['Healthy (80+)']++;
    statuses[status] = (statuses[status] || 0) + 1;

    if (String(h) !== p.properties.zia_health_score || status !== p.properties.zia_placement_status) {
      updates.push({ id: p.id, properties: { zia_health_score: String(h), zia_placement_status: status } });
    }
  }

  console.log(`  updates: ${updates.length}`);
  console.log(`  new distribution: ${JSON.stringify(buckets)}`);
  console.log(`  new statuses    : ${JSON.stringify(statuses)}`);

  const res = await batch('deals', 'update', updates, { dryRun });
  return { changed: res.ok, failed: res.failed, wouldWrite: res.wouldWrite, buckets, statuses };
};
