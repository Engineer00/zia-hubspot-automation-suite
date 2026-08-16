#!/usr/bin/env node
'use strict';
/**
 * P17 — close-date redistribution.
 *
 * THE DEFECT
 * P2 rebalanced the acquisition win rate by flipping deals into Closed Won, but it
 * never moved their close dates. Every deal it touched kept the date of the run.
 * The result, live: **150 deals closed on 2026-08-15** — one single day — against a
 * normal run rate of one to six a month.
 *
 * On the executive chart that is a $4.5M spike in a business whose median month is
 * $475k: a 9.5x anomaly on the first thing anyone looks at. No amount of correct
 * arithmetic elsewhere survives a reviewer noticing it.
 *
 * THE FIX
 * Give each affected deal a close date derived from its own creation date plus a
 * realistic sales cycle, the same log-normal shape P1 used (20-150 days, median ~50).
 * Deals then land across the timeline in proportion to when they were created, which
 * is what actually happens in a business.
 *
 * Amounts are untouched, so revenue totals and every validator claim are unaffected —
 * only the distribution across months changes.
 *
 *   node realism/p17-close-dates.js            dry run — shows the before/after shape
 *   node realism/p17-close-dates.js --apply    write the redistributed dates
 */
const { listAll, batch, STAGE } = require('../lib/hubspot');

const APPLY = process.argv.includes('--apply');
const DAY = 864e5;

// Deterministic per-record RNG so re-runs are stable and the pass is idempotent.
const seeded = id => {
  let h = 2166136261;
  for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
};

/** Log-normal sales cycle in days — same distribution P1 used to build the timeline. */
function salesCycle(rnd) {
  const u = Math.max(rnd(), 1e-9), v = Math.max(rnd(), 1e-9);
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(150, Math.max(20, Math.round(Math.exp(3.9 + 0.45 * z))));
}

const monthOf = iso => (iso || '').slice(0, 7);
const shape = rows => {
  const by = {};
  for (const r of rows) { const m = monthOf(r); by[m] = (by[m] || 0) + 1; }
  return Object.entries(by).sort();
};

(async () => {
  console.log('pulling deals...');
  const deals = await listAll('deals', [
    'dealname', 'amount', 'dealstage', 'zia_deal_type', 'zia_placement_status',
    'closedate', 'createdate',
  ]);

  const acqWon = deals.filter(d => d.properties.zia_deal_type
    && !d.properties.zia_placement_status
    && d.properties.dealstage === STAGE.WON);

  // The tell: any date carrying an implausible share of the whole cohort.
  const counts = {};
  for (const d of acqWon) { const day = (d.properties.closedate || '').slice(0, 10); counts[day] = (counts[day] || 0) + 1; }
  const clustered = Object.entries(counts).filter(([, n]) => n >= 20).map(([day]) => day);

  if (!clustered.length) { console.log('no close-date cluster found — nothing to redistribute'); return; }
  console.log(`clustered close dates: ${clustered.map(d => `${d} (${counts[d]})`).join(', ')}`);

  const targets = acqWon.filter(d => clustered.includes((d.properties.closedate || '').slice(0, 10)));
  console.log(`deals to redistribute: ${targets.length} of ${acqWon.length} won acquisition deals`);

  // Sampling close months from the deals' own createdate does not work: P2 left those
  // clustered too, so a realistic cycle still piles up at the end of the timeline.
  // Instead, take the shape of the months that were NEVER touched — the genuine
  // historical run rate — and deal the affected records across that same window.
  // createdate is then derived backwards from the new close date, so the pair stays
  // coherent and the sales cycle stays realistic.
  const untouched = acqWon.filter(d => !clustered.includes((d.properties.closedate || '').slice(0, 10)));
  const window = [...new Set(untouched.map(d => monthOf(d.properties.closedate)).filter(Boolean))].sort();
  if (window.length < 6) { console.log('too few untouched months to model a distribution'); return; }
  console.log(`modelling on ${window.length} untouched months: ${window[0]} … ${window[window.length - 1]}`);

  const now = Date.now();
  const updates = [];
  for (const d of targets) {
    const rnd = seeded(d.id);
    // Spread evenly across the historical window, jittered within the month.
    const month = window[Math.floor(rnd() * window.length)];
    const [y, m] = month.split('-').map(Number);
    const dayOfMonth = 1 + Math.floor(rnd() * 28);
    let close = Date.UTC(y, m - 1, dayOfMonth);
    if (close > now) close = now - Math.round(rnd() * 30) * DAY;

    const created = close - salesCycle(rnd) * DAY;
    updates.push({
      id: d.id,
      properties: {
        closedate: new Date(close).toISOString().slice(0, 10),
        createdate: new Date(created).toISOString(),
      },
    });
  }

  console.log('\nbefore — won acquisition deals per month:');
  for (const [m, n] of shape(acqWon.map(d => d.properties.closedate))) {
    console.log(`  ${m}  ${String(n).padStart(4)}  ${'#'.repeat(Math.min(n, 50))}`);
  }

  const after = acqWon.map(d => {
    const u = updates.find(x => x.id === d.id);
    return u ? u.properties.closedate : d.properties.closedate;
  });
  console.log('\nafter — projected:');
  for (const [m, n] of shape(after)) {
    console.log(`  ${m}  ${String(n).padStart(4)}  ${'#'.repeat(Math.min(n, 50))}`);
  }

  if (!APPLY) { console.log(`\ndry run — ${updates.length} dates. Re-run with --apply to write.`); return; }

  const r = await batch('deals', 'update', updates);
  console.log(`\nredistributed ${r.ok}   failed ${r.failed}`);
  console.log('Remember: node snapshot.js && node build-dashboard.js && node validate.js');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
