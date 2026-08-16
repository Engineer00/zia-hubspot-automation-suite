#!/usr/bin/env node
'use strict';
/**
 * Injects dashboard-data.json into the template and writes the publishable page.
 *   node snapshot.js && node build-dashboard.js
 *
 * WHY THIS FILE VALIDATES BEFORE IT WRITES
 * The template reads fields off the snapshot. When snapshot.js gained new fields
 * (`companies.book`, `tierStats[].acqDeals`, `invoicing.overdueValue`) and the page
 * was built against an older JSON that lacked them, `num(undefined)` threw inside the
 * tier table — and because one uncaught error halts the whole script, **every chart
 * below that point silently vanished**. The page still looked plausible: headers and
 * counts rendered, so nothing announced that half the deck was missing.
 *
 * A build that can produce a half-empty dashboard without complaining is worse than
 * one that fails. So: check the contract first, then write.
 */
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'dashboard-data.json');
const TEMPLATE = path.join(__dirname, 'zia-command-deck.html');
const DEST = path.join(__dirname, 'dist-command-deck.html');

/** Every path the template dereferences. Add to this when the template grows. */
const REQUIRED = [
  'totals.companies', 'totals.contacts', 'totals.deals', 'totals.talent',
  'totals.placements', 'totals.openTickets', 'totals.tickets',
  'revenue.acqWonValue', 'revenue.acqWinRate', 'revenue.acqWon', 'revenue.acqLost',
  'revenue.acqOpen', 'revenue.openPipeline', 'revenue.deliveredValue',
  'placements.active', 'placements.atRisk', 'placements.avgHealth', 'placements.avgHours',
  'placements.totalWeeklyHours', 'placements.healthBuckets', 'placements.utilBuckets',
  'talent.bench', 'talent.compliance', 'talent.coverage',
  'companies.industry', 'companies.byState', 'companies.book',
  'tickets.byType', 'tickets.openByType', 'tickets.slaBreached',
  'invoicing.total', 'invoicing.byStatus', 'invoicing.collected', 'invoicing.outstanding',
  'invoicing.overdueValue', 'invoicing.writtenOff', 'invoicing.agingBuckets', 'invoicing.avgDaysToPay',
  'discounting.lineItems', 'funnel', 'trend', 'tierStats', 'lossReasons', 'serviceDemand',
  'capability.sectorExpertise', 'capability.benchReadyLines', 'capability.grade',
  'capability.avgHealthByGrade', 'capability.match', 'capability.medianYears',
  'outlook.winBy', 'outlook.forecast', 'outlook.expectedRevenue', 'outlook.openValue',
  'outlook.deliveryAtRisk', 'outlook.collections',
  'intelligence.byCategory', 'intelligence.signals', 'intelligence.weighted', 'intelligence.scored',
];

/** Fields required on every element of an array. */
const REQUIRED_IN = {
  tierStats: ['tier', 'acqDeals', 'acqWon', 'winRate', 'revenue', 'acqAvgDeal', 'placements', 'avgHealth'],
  funnel: ['stage', 'count', 'value'],
  trend: ['month', 'value'],
};

const dig = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

const raw = fs.readFileSync(DATA, 'utf8');
const data = JSON.parse(raw);

const missing = REQUIRED.filter(p => dig(data, p) === undefined);
for (const [key, fields] of Object.entries(REQUIRED_IN)) {
  const arr = data[key];
  if (!Array.isArray(arr) || !arr.length) continue;
  for (const f of fields) {
    if (arr[0][f] === undefined) missing.push(`${key}[].${f}`);
  }
}

if (missing.length) {
  console.error('REFUSING TO BUILD — dashboard-data.json is missing fields the template reads:\n');
  for (const m of missing) console.error(`  · ${m}`);
  console.error(`\nThe page would render its header and then silently lose every chart below`);
  console.error(`the first field it could not read. Run "node snapshot.js" and rebuild.`);
  process.exit(1);
}

const tpl = fs.readFileSync(TEMPLATE, 'utf8');
if (!tpl.includes('__DATA__')) {
  console.error('template has no __DATA__ placeholder — was it already built over?');
  process.exit(1);
}

const out = tpl.replace('__DATA__', JSON.stringify(data));
fs.writeFileSync(DEST, out);

const age = (Date.now() - new Date(data.generatedAt)) / 60000;
console.log(`wrote ${DEST}`);
console.log(`  template ${(tpl.length / 1024).toFixed(1)} kB + data ${(raw.length / 1024).toFixed(1)} kB`
  + ` -> ${(out.length / 1024).toFixed(1)} kB`);
console.log(`  ${REQUIRED.length} required fields present · snapshot ${age.toFixed(0)} min old`);
if (age > 60) console.log('  NOTE: snapshot is over an hour old — run node snapshot.js for current figures.');
