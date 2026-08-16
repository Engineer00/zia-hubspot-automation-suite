#!/usr/bin/env node
'use strict';
/**
 * Realism pass runner.
 *   node realism/run-all.js --dry-run
 *   node realism/run-all.js
 *   node realism/run-all.js --only p3,p4
 *
 * Order matters: stages settle (p2) -> health agrees with them (p3) ->
 * identities (p4) -> timeline derives from final dates (p1) -> engagements
 * are placed inside that timeline (p5).
 */
const PHASES = [
  ['p0', 'Re-skin to ZIA',       require('./p0-reskin')],
  ['p2', 'Realistic win rate',   require('./p2-winrate')],
  ['p3', 'Believable health',    require('./p3-health')],
  ['p4', 'Real identities',      require('./p4-identities')],
  ['p1', 'Coherent timeline',    require('./p1-timeline')],
  ['p5', 'Activity history',     require('./p5-engagements')],
];

(async () => {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run') || argv.includes('-n');
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx > -1 ? (argv[onlyIdx + 1] || '').split(',').map(s => s.trim()) : null;

  const run = PHASES.filter(([id]) => !only || only.includes(id));

  console.log('='.repeat(64));
  console.log(`REALISM PASS  ${dryRun ? '[DRY RUN — no writes]' : '[LIVE]'}   ${run.length} phase(s)`);
  console.log('='.repeat(64));

  for (const [id, name, fn] of run) {
    console.log(`\n${id.toUpperCase()}  ${name}`);
    const t0 = Date.now();
    try {
      const res = await fn({ dryRun });
      for (const [k, v] of Object.entries(res)) {
        if (v === undefined) continue;
        console.log(`  = ${k.padEnd(18)} ${typeof v === 'object' ? JSON.stringify(v) : v}`);
      }
      console.log(`  = ${'elapsed'.padEnd(18)} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      console.error(`  ERROR ${e.message}`);
      process.exitCode = 1;
    }
  }
  console.log('\ndone.');
})();
