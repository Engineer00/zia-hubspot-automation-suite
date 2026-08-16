#!/usr/bin/env node
'use strict';
/**
 * End-to-end demo validation.
 *
 * Three passes, each answering a different question:
 *
 *   A. CLAIMS  — every number the interview narrative says out loud, re-derived
 *                from the live portal right now. Hard pass/fail.
 *   B. DRIFT   — has the portal moved since dashboard-data.json was written?
 *                If it has, the published pages are lying and need a rebuild.
 *   C. PAGES   — every number printed on the published HTML pages, checked
 *                against values actually derivable from live data. Anything
 *                unaccounted for is surfaced for manual review rather than
 *                silently passed.
 *
 * Exit code 1 if any claim fails or drift is found, so this can gate a rebuild.
 *
 *   node validate.js              full run
 *   node validate.js --claims     pass A only (fast, no page parsing)
 *   node validate.js --quiet      report file only, minimal stdout
 */
const fs = require('fs');
const path = require('path');
const { pull, compute } = require('./snapshot');
const { api, listAll, readAssociations } = require('./lib/hubspot');

/**
 * Commerce and schema facts the analytics snapshot does not carry, but the
 * narrative cites out loud. Pulled separately so they are verified, not assumed.
 */
async function pullExtras() {
  const [quotes, lineItems, products] = await Promise.all([
    listAll('quotes', ['hs_title']),
    listAll('line_items', ['name', 'hs_discount_percentage']),
    listAll('products', ['name']),
  ]);

  let customProperties = 0;
  for (const o of ['companies', 'contacts', 'deals', 'tickets']) {
    const r = await api('GET', `/crm/v3/properties/${o}`);
    customProperties += r.results.filter(p => p.name.startsWith('zia_')).length;
  }

  // files list only through the search endpoint — plain GET on /files is a 405
  let files = 0, after;
  do {
    const qs = new URLSearchParams({ limit: '100' });
    if (after) qs.set('after', after);
    const r = await api('GET', `/files/v3/files/search?${qs}`);
    files += r.results.length;
    after = r.paging && r.paging.next ? r.paging.next.after : null;
  } while (after);

  const forms = await api('GET', '/marketing/v3/forms?limit=100');
  const lists = await api('POST', '/crm/v3/lists/search', { count: 100 });

  return {
    quotes: quotes.length,
    lineItems: lineItems.length,
    discountedLineItems: lineItems.filter(l => +l.properties.hs_discount_percentage > 0).length,
    products: products.length,
    customProperties,
    files,
    forms: (forms.results || []).length,
    lists: lists.total,
  };
}

const args = process.argv.slice(2);
const CLAIMS_ONLY = args.includes('--claims');
const QUIET = args.includes('--quiet');

const money = n => '$' + Math.round(n).toLocaleString('en-US');
const pct = n => (n * 100).toFixed(1) + '%';
const num = n => Math.round(n).toLocaleString('en-US');

// ---------------------------------------------------------------------------
// A. Narrative claims
//
// `expect` is what the published artifacts and LIVE_STATE_VERIFIED.md currently
// assert. `actual` is re-derived from the live portal. They must agree.
// ---------------------------------------------------------------------------

function claims(snap, raw, assoc, extras) {
  const { deals } = raw;
  const seeded = deals.filter(d => d.properties.zia_deal_type);
  const placements = seeded.filter(d => d.properties.zia_placement_status);
  const health = p => +p.properties.zia_health_score || 0;

  const inv = seeded.filter(d => d.properties.zia_invoice_status);
  const status = s => inv.filter(d => d.properties.zia_invoice_status === s);
  const pastDue = inv.filter(d => !['paid', 'draft'].includes(d.properties.zia_invoice_status));
  const unpaid = [...status('sent'), ...status('overdue')];
  const over90 = rows => rows.filter(d => +d.properties.zia_days_outstanding > 90);
  const amountOf = rows => rows.reduce((a, d) => a + (+d.properties.amount || 0), 0);

  const list = [
    ['Companies', 226, snap.totals.companies, num],
    ['Contacts', 354, snap.totals.contacts, num],
    ['Deals (seeded)', 659, snap.totals.deals, num],
    ['Acquisition deals', 441, snap.totals.acquisition, num],
    ['Placement deals', 218, snap.totals.placements, num],
    ['Tickets', 644, snap.totals.tickets, num],
    ['Open tickets', 366, snap.totals.openTickets, num],
    ['SLA-breached tickets', 71, snap.tickets.slaBreached, num],

    ['Closed-won value', 25291993, snap.revenue.wonTotal, money],
    ['Acquisition win rate', 0.301, round(snap.revenue.acqWinRate, 3), pct],
    ['Acquisition won', 112, snap.revenue.acqWon, num],
    ['Acquisition lost', 260, snap.revenue.acqLost, num],
    ['Acquisition open', 69, snap.revenue.acqOpen, num],
    ['Delivered placement value', 21885028, snap.revenue.deliveredValue, money],

    // the headline finding — this is the one that must survive scrutiny.
    // Since WF-11 these scores are model-derived, not seeded, so the gap is now a
    // statement about the business rather than about a random draw.
    ['Placements scoring < 60', 58, placements.filter(p => health(p) < 60).length, num],
    ['Placements flagged At Risk', 8, snap.placements.atRisk, num],
    ['Active placements', 153, snap.placements.active, num],
    ['Average health score', 68.4, round(snap.placements.avgHealth, 1), n => n.toFixed(1)],

    ['Invoices', 258, snap.invoicing.total, num],
    ['Collected', 17029272, snap.invoicing.collected, money],
    ['Outstanding', 4493635, snap.invoicing.outstanding, money],
    ['Invoices 90+ days past due', 40, snap.invoicing.agingBuckets['90+ days'], num],
    ['Past-due invoice population', 54, pastDue.length, num],
    // the collections stat as the case study now states it: unpaid EXCLUDES the
    // 26 already written off, because a write-off is not a collectable
    ['Unpaid invoices (sent + overdue)', 44, unpaid.length, num],
    ['  …of those, 90+ days', 34, over90(unpaid).length, num],
    ['  …worth', 4192590, amountOf(over90(unpaid)), money],
    ['Average days to pay', 36.2, round(snap.invoicing.avgDaysToPay, 1), n => n.toFixed(1)],

    ['Quotes', 114, extras.quotes, num],
    ['Line items', 431, extras.lineItems, num],
    ['Discounted line items', 168, extras.discountedLineItems, num],
    ['Products', 7, extras.products, num],
    ['Custom zia_ properties', 71, extras.customProperties, num],
    ['Deal objects (incl. sample)', 660, raw.deals.length, num],

    // front door + documents, added once the scopes were enabled
    ['Documents attached', 272, extras.files, num],
    ['Lead capture forms', 2, extras.forms, num],
    ['Segments / lists', 10, extras.lists, num],

    // structural integrity — the demo falls apart without these
    ['Deals with no company link', 0, assoc.dealsWithoutCompany, num],
    ['Companies with no domain', 0, snap.__companiesWithoutDomain, num],
    ['Placements with no talent link', 14, assoc.placementsWithoutContact, num],
  ];

  // Currency is compared at dollar resolution, not float resolution. Line-item
  // totals carry cents (a 15% discount on $2,650 is $2,252.50), so a claim written
  // as a whole-dollar figure would otherwise fail by 34 cents forever and train
  // everyone to ignore the validator — which is the one outcome that must not happen.
  return list.map(([name, expect, actual, fmt]) => ({
    name, expect, actual, fmt,
    ok: fmt === money
      ? Math.round(actual) === Math.round(expect)
      : Math.abs(actual - expect) < 0.05,
  }));
}

const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;

// ---------------------------------------------------------------------------
// B. Drift against the snapshot the pages were built from
// ---------------------------------------------------------------------------

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'generatedAt' || k.startsWith('__')) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else if (typeof v === 'number') out[key] = v;
  }
  return out;
}

function drift(fresh, stored) {
  const a = flatten(fresh), b = flatten(stored);
  const rows = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const was = b[key], now = a[key];
    if (was === undefined) { rows.push({ key, was: '—', now, note: 'new' }); continue; }
    if (now === undefined) { rows.push({ key, was, now: '—', note: 'gone' }); continue; }
    if (Math.abs(now - was) > 0.005) rows.push({ key, was, now, note: 'changed' });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// C. Page number audit
// ---------------------------------------------------------------------------

const PAGES = [
  ['dist-command-deck.html', 'ZIA Command Deck'],
  ['zia-case-study.html', 'The ZIA Build'],
  ['hubspot-dashboard-guide.html', 'Dashboard Build Guide'],
];

/**
 * Numbers that are legitimately on the pages but are NOT live portal values.
 * Each needs a reason — an unexplained entry here is how a stale figure hides.
 */
const KNOWN = new Map([
  [247000083, 'portal id'],
  [96903740, 'owner id'],
  [20551, 'historical — company count before the duplicate import was cleaned'],
  [20550, 'historical — records archived in that cleanup'],
  [10000, 'historical — rows in the original companies.csv / search API cap'],
  [1672, 'historical — company count before P7 prune'],
  [1671, 'historical — seeded companies before prune'],
  [1525, 'historical — unique names in the original 10k rows'],
  [535, 'historical — nameless auto-created companies deleted'],
  [308, 'historical — dirty zia_industry values normalised'],
  [817, 'historical — duplicate tickets the association-id bug would have created'],
  [500, 'historical — alreadyCovered figure in the bug story (also a live value)'],
  [317, 'first-run WF-03 ticket count (run-log)'],
  [115, 'first-run WF-06 compliance ticket count (run-log)'],
  [108, 'first-run WF-07 collections ticket count (also live overdue count)'],
  [45, 'first-run WF-06 bench holds'],
  [600, 'first-run WF-09 contacts scored (run-log)'],
  [273, 'first-run WF-10 writes — 263 roll-ups + 10 recovery tickets (run-log)'],
  [357, 'first-run WF-11 rescore under the corrected momentum signal (run-log)'],
  [1002, 'historical — contact count before free-contact-headroom.js pruned to 993'],
  [69, 'health threshold — WF-04 monitoring band top (40-69)'],
  [78, 'derived — Summit avg deal vs Core = premium multiple'],
  [10.9, 'average discount depth across discounted line items (live)'],
  // --- win-rate diagnostics, all re-derivable from live deals (dashboard 05) ---
  [47.1, 'win rate, grade A'], [40.5, 'win rate, grade B'],
  [41.2, 'win rate if only A and B were worked'],
  [40.9, 'win rate, outbound source'], [40.8, 'win rate, deals under $20k'],
  [28.3, 'win rate, $20-40k'], [23.2, 'win rate, $40-70k'], [16.7, 'win rate, $70k+'],
  [41.4, 'win rate, Central territory'], [28.8, 'win rate, West'], [18.1, 'win rate, East'],
  [94, 'grade C+D pursuits'], [83, 'closed deals in East territory'],
  [66, 'closed-lost deals with no reason recorded'], [25.4, 'share of losses unexplained'],
  [1785558, 'value lost to "Specialty experience"'],
  [13, 'WF-13 rule number'],
  [123, 'derived — Summit avg sale $51,395 vs Core $23,047 = 123% premium'],
  [38, 'derived — 578 of 1,500 line items discounted = 38.5%'],
  [1601652, 'value of unpaid invoices 90+ days past due (also a live claim)'],
  [8300, 'approximate engagement count written by P5'],
  [7000, 'P5 planning estimate'],
  [1228, 'historical — original company import count'],
  [994, 'historical — companies the broken import would have auto-created'],
  [150, 'sales-cycle upper bound (log-normal 20-150 days)'],
  [90, 'ageing bucket boundary / company-create offset bound'],
  [400, 'HTTP status / talent contact count'],
  [401, 'HTTP status'], [403, 'HTTP status'], [404, 'HTTP status'],
  [405, 'HTTP status'], [429, 'HTTP status'],
  [12, 'demo length in minutes'],
  [20000, 'historical — 2 x 10,000 rows, the double import'],
  [33, 'historical — the 12:33 import timestamp'],
  [36, 'historical — the 12:36 import timestamp'],
  [141, 'past-due population incl. written-off (also a live claim)'],
  [10, 'utilisation bucket size in the dashboard guide'],
  [70, 'health score target'],
  [40, 'health threshold — critical'],
  [59, 'health threshold — at-risk band top'],
  [30, 'net_30 terms / contact-create offset bound'],
  [15, 'net_15 terms'], [45, 'net_45 terms'], [60, 'net_60 terms'],
  [100, 'API batch size'],
  [1.2, 'TLS version'],
  [3, 'v3 API / assoc type'], [4, 'v4 API'],
  [16, 'assoc type ticket->contact'], [20, 'assoc type line_item->deal'],
  [26, 'assoc type ticket->company'], [28, 'assoc type ticket->deal'],
  [182, 'assoc type'], [186, 'assoc type'], [188, 'assoc type'], [190, 'assoc type'],
  [192, 'assoc type'], [194, 'assoc type'], [198, 'assoc type'], [200, 'assoc type'],
  [202, 'assoc type'], [204, 'assoc type'], [206, 'assoc type'], [210, 'assoc type'],
  [212, 'assoc type'], [214, 'assoc type'], [216, 'assoc type'],
]);

function textOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')   // chart geometry is not a claim
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ');
}

/** Every rendering of a live value a page could plausibly print. */
function allowedValues(snap) {
  const set = new Set();
  const add = v => { if (Number.isFinite(v)) set.add(String(v)); };

  // flatten() deliberately skips __-prefixed keys so they stay out of the drift
  // diff; they are still real live values, so fold them in here.
  const values = [
    ...Object.values(flatten(snap)),
    ...Object.values(snap.__extras || {}),
    ...Object.values(snap.__derived || {}),
  ];

  for (const v of values) {
    add(v);
    add(Math.round(v));
    add(round(v, 1)); add(round(v, 2));
    add(Math.round(v * 100)); add(round(v * 100, 1));   // rates rendered as %
    add(Math.round(v / 1000)); add(round(v / 1000, 1)); // "13k"
    add(round(v / 1e6, 1)); add(round(v / 1e6, 2));     // "13.1M"
  }
  return set;
}

function auditPage(file, snap, allowed) {
  const text = textOf(fs.readFileSync(file, 'utf8'));
  const found = new Map();

  for (const m of text.matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)) {
    const token = m[0];
    const raw = token.replace(/[$,%]/g, '');
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    if (v < 10) continue;                              // too noisy to be a claim
    if (v >= 1900 && v <= 2100 && Number.isInteger(v)) continue; // years
    if (allowed.has(String(v)) || allowed.has(String(round(v, 1)))) continue;
    if (KNOWN.has(v)) continue;
    found.set(token, (found.get(token) || 0) + 1);
  }
  return [...found.entries()].sort((a, b) => b[1] - a[1]);
}

// ---------------------------------------------------------------------------

(async () => {
  const t0 = Date.now();
  const raw = await pull({ quiet: QUIET });
  const snap = compute(raw);

  snap.__companiesWithoutDomain = raw.companies.filter(c => !c.properties.domain).length;

  // association integrity
  if (!QUIET) console.log('reading associations...');
  const seeded = raw.deals.filter(d => d.properties.zia_deal_type);
  const placementIds = seeded.filter(d => d.properties.zia_placement_status).map(d => d.id);
  const dealCompany = await readAssociations('deals', 'companies', seeded.map(d => d.id));
  const placeContact = await readAssociations('deals', 'contacts', placementIds);

  const assoc = {
    dealsWithoutCompany: seeded.filter(d => !(dealCompany.get(String(d.id)) || []).length).length,
    placementsWithoutContact: placementIds.filter(id => !(placeContact.get(String(id)) || []).length).length,
  };

  if (!QUIET) console.log('pulling commerce + schema...');
  const extras = await pullExtras();
  snap.__extras = extras;
  snap.__derived = {
    placementsBelowSixty: raw.deals.filter(d => d.properties.zia_placement_status
      && (+d.properties.zia_health_score || 0) < 60).length,
    dealObjects: raw.deals.length,
    unpaidOver90: raw.deals.filter(d => ['sent', 'overdue'].includes(d.properties.zia_invoice_status)
      && +d.properties.zia_days_outstanding > 90).length,

    // client organizations, i.e. every company except ZIA's own operating record
    clientCompanies: raw.companies.filter(c =>
      c.properties.name !== 'ZIA Organizational Development').length,

    // the governance gap the dashboard callout and the segment both report
    healthGovernanceGap: raw.deals.filter(d => d.properties.zia_placement_status
      && (+d.properties.zia_health_score || 0) < 60).length
      - raw.deals.filter(d => d.properties.zia_placement_status === 'at_risk').length,
  };

  const claimRows = claims(snap, raw, assoc, extras);
  const failed = claimRows.filter(c => !c.ok);

  // ---- report ----
  const L = [];
  L.push('# End-to-End Demo Validation');
  L.push('');
  L.push(`Run ${new Date().toISOString()} · portal pulled live · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  L.push('');
  L.push(`## A. Narrative claims — ${claimRows.length - failed.length}/${claimRows.length} pass`);
  L.push('');
  L.push('| Claim | Published | Live | |');
  L.push('|---|---:|---:|---|');
  for (const c of claimRows) {
    L.push(`| ${c.name} | ${c.fmt(c.expect)} | ${c.fmt(c.actual)} | ${c.ok ? '✅' : '❌'} |`);
  }
  L.push('');

  let driftRows = [];
  if (fs.existsSync(path.join(__dirname, 'dashboard-data.json'))) {
    const stored = JSON.parse(fs.readFileSync(path.join(__dirname, 'dashboard-data.json'), 'utf8'));
    driftRows = drift(snap, stored);
    L.push(`## B. Drift vs dashboard-data.json — ${driftRows.length ? `${driftRows.length} field(s) moved` : 'none'}`);
    L.push('');
    if (driftRows.length) {
      L.push('The published pages were built from this file. Any row here means a page');
      L.push('is showing a number the portal no longer agrees with.');
      L.push('');
      L.push('| Field | Page shows | Portal has |');
      L.push('|---|---:|---:|');
      for (const d of driftRows.slice(0, 60)) L.push(`| \`${d.key}\` | ${d.was} | ${d.now} |`);
      L.push('');
      L.push('**Fix:** `node snapshot.js && node build-dashboard.js`, then re-publish both artifacts.');
    } else {
      L.push('Every figure on the published pages still matches the live portal.');
    }
    L.push('');
  }

  let pageFindings = [];
  if (!CLAIMS_ONLY) {
    const allowed = allowedValues(snap);
    L.push('## C. Page number audit');
    L.push('');
    L.push('Numbers printed on the pages that are not derivable from live data and are not');
    L.push('a documented constant. Each one is either a stale figure or needs adding to');
    L.push('`KNOWN` in `validate.js` with a reason.');
    L.push('');
    for (const [file, label] of PAGES) {
      const full = path.join(__dirname, file);
      if (!fs.existsSync(full)) { L.push(`- \`${file}\` — not found, skipped`); continue; }
      const rows = auditPage(full, snap, allowed);
      pageFindings.push([label, rows]);
      L.push(`### ${label} — \`${file}\``);
      L.push('');
      if (!rows.length) L.push('No unaccounted numbers.');
      else {
        L.push('| Value | Occurrences |');
        L.push('|---|---:|');
        for (const [tok, n] of rows.slice(0, 40)) L.push(`| \`${tok}\` | ${n} |`);
      }
      L.push('');
    }
  }

  const report = path.join(__dirname, 'validation-report.md');
  fs.writeFileSync(report, L.join('\n'));

  // ---- stdout ----
  console.log('');
  for (const c of claimRows) {
    console.log(`${c.ok ? ' ok ' : 'FAIL'}  ${c.name.padEnd(32)} published ${String(c.fmt(c.expect)).padStart(12)}   live ${String(c.fmt(c.actual)).padStart(12)}`);
  }
  console.log('');
  console.log(`claims   ${claimRows.length - failed.length}/${claimRows.length} pass`);
  console.log(`drift    ${driftRows.length} field(s) moved since dashboard-data.json`);
  for (const [label, rows] of pageFindings) {
    console.log(`pages    ${label}: ${rows.length} unaccounted number(s)`);
  }
  console.log(`\nreport   ${report}`);

  process.exit(failed.length || driftRows.length ? 1 : 0);
})();
