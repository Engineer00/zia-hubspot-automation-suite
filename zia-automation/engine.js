#!/usr/bin/env node
'use strict';
/**
 * ZIA automation engine.
 *
 * Replaces tier-gated HubSpot workflows with scheduled, idempotent API jobs.
 * Every rule is safe to re-run: each one reconciles current state rather than
 * reacting to a one-shot event, so a missed run self-heals on the next pass.
 *
 *   node engine.js --dry-run          evaluate everything, write nothing
 *   node engine.js                    run all rules
 *   node engine.js --only WF-03,WF-05 run specific rules
 *   node engine.js --list             show the rule catalogue
 */
const fs = require('fs');
const path = require('path');

const RULES_DIR = path.join(__dirname, 'rules');
const LOG_FILE = path.join(__dirname, 'run-log.jsonl');

function loadRules() {
  return fs.readdirSync(RULES_DIR)
    .filter(f => f.endsWith('.js'))
    .sort()
    .map(f => require(path.join(RULES_DIR, f)));
}

function parseArgs(argv) {
  const args = { dryRun: false, only: null, list: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '-n') args.dryRun = true;
    else if (a === '--list') args.list = true;
    else if (a === '--only') args.only = (argv[++i] || '').split(',').map(s => s.trim().toUpperCase());
  }
  return args;
}

(async () => {
  const args = parseArgs(process.argv);
  const rules = loadRules();

  if (args.list) {
    console.log('\nZIA automation rules\n');
    for (const r of rules) console.log(`  ${r.id}  ${r.name}`);
    console.log('');
    return;
  }

  const selected = args.only ? rules.filter(r => args.only.includes(r.id)) : rules;
  if (!selected.length) {
    console.error(`No rules matched ${args.only ? args.only.join(',') : '(all)'}`);
    process.exit(1);
  }

  const startedAt = new Date().toISOString();
  console.log('='.repeat(66));
  console.log(`ZIA AUTOMATION ENGINE   ${args.dryRun ? '[DRY RUN — no writes]' : '[LIVE]'}`);
  console.log(`${startedAt}   ${selected.length} rule(s)`);
  console.log('='.repeat(66));

  const summary = [];
  let hadError = false;

  for (const rule of selected) {
    const t0 = Date.now();
    process.stdout.write(`\n${rule.id}  ${rule.name}\n`);
    try {
      const result = await rule.run({ dryRun: args.dryRun });
      const ms = Date.now() - t0;
      for (const [k, v] of Object.entries(result)) {
        if (v === undefined) continue;
        const val = typeof v === 'object' ? JSON.stringify(v) : v;
        console.log(`    ${k.padEnd(16)} ${val}`);
      }
      console.log(`    ${'elapsed'.padEnd(16)} ${ms}ms`);
      summary.push({ id: rule.id, name: rule.name, ok: true, ms, ...result });
    } catch (e) {
      hadError = true;
      console.error(`    ERROR  ${e.message}`);
      summary.push({ id: rule.id, name: rule.name, ok: false, error: e.message });
    }
  }

  console.log('\n' + '='.repeat(66));
  console.log('SUMMARY');
  console.log('='.repeat(66));
  // Every key a rule may use to report a write. Missing one makes the summary say
  // "wrote 0" for a rule that wrote hundreds — which silently breaks the convergence
  // check this whole design rests on, since "wrote 0 on the second pass" is the proof.
  const WRITE_KEYS = [
    'changed', 'created', 'ticketed', 'scored', 'rescored', 'routed',
    'accountsRolledUp', 'recoveryTickets', 'benched', 'reconciled',
    'companiesCreated', 'associated', 'rewound',
  ];
  const writesOf = s => WRITE_KEYS.reduce((n, k) => n + (typeof s[k] === 'number' ? s[k] : 0), 0);

  let anyFailedWrites = false;
  for (const s of summary) {
    if (s.failed) anyFailedWrites = true;
    const flag = s.ok
      ? (s.wouldWrite ? `would write ${s.wouldWrite}` : `wrote ${writesOf(s)}`)
      : 'FAILED';
    const suffix = s.failed ? `  ${s.failed} FAILED WRITE(S)` : '';
    console.log(`  ${s.id.padEnd(7)} ${s.name.padEnd(32)} ${flag}${suffix}`);
  }
  // A rule that returns ok:true while every batch it issued was rejected is not a
  // success. Surface it in the exit code so a scheduled run cannot fail quietly.
  if (anyFailedWrites) hadError = true;

  const entry = { startedAt, finishedAt: new Date().toISOString(), dryRun: args.dryRun, results: summary };
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  console.log(`\nappended to ${path.basename(LOG_FILE)}`);

  process.exitCode = hadError ? 1 : 0;
})();

