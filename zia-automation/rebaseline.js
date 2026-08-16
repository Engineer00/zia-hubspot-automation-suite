#!/usr/bin/env node
'use strict';
/**
 * Re-baseline validate.js after a DELIBERATE change of scale.
 *
 * The validator exists to catch drift between the published artifacts and the live
 * portal. After an intentional rescale every claim legitimately moves at once, so the
 * baseline has to be reset — but only ever explicitly, by running this, never silently
 * as a side effect of validation. If this were automatic the validator would always
 * pass and would be worth nothing.
 *
 *   node rebaseline.js            show what would change
 *   node rebaseline.js --apply    rewrite the expected values in validate.js
 */
const fs = require('fs');
const path = require('path');
const { api, listAll, readAssociations, STAGE } = require('./lib/hubspot');

const APPLY = process.argv.includes('--apply');
const FILE = path.join(__dirname, 'validate.js');

(async () => {
  const snap = JSON.parse(fs.readFileSync(path.join(__dirname, 'dashboard-data.json'), 'utf8'));

  const deals = await listAll('deals', ['zia_deal_type', 'zia_placement_status',
    'zia_invoice_status', 'zia_days_outstanding', 'amount', 'zia_health_score']);
  const seeded = deals.filter(d => d.properties.zia_deal_type);
  const placements = seeded.filter(d => d.properties.zia_placement_status);
  const inv = seeded.filter(d => d.properties.zia_invoice_status);
  const status = v => inv.filter(d => d.properties.zia_invoice_status === v);
  const pastDue = inv.filter(d => !['paid', 'draft'].includes(d.properties.zia_invoice_status));
  const unpaid = [...status('sent'), ...status('overdue')];
  const over90 = rows => rows.filter(d => +d.properties.zia_days_outstanding > 90);
  const amountOf = rows => Math.round(rows.reduce((a, d) => a + (+d.properties.amount || 0), 0));

  const [quotes, lineItems, products] = await Promise.all([
    listAll('quotes', ['hs_title']),
    listAll('line_items', ['hs_discount_percentage']),
    listAll('products', ['name']),
  ]);
  let customProperties = 0;
  for (const o of ['companies', 'contacts', 'deals', 'tickets']) {
    const r = await api('GET', `/crm/v3/properties/${o}`);
    customProperties += r.results.filter(p => p.name.startsWith('zia_')).length;
  }
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

  const dc = await readAssociations('deals', 'companies', seeded.map(d => d.id));
  const dct = await readAssociations('deals', 'contacts', placements.map(d => d.id));

  // label -> new expected value. Labels must match validate.js exactly.
  const next = {
    'Companies': snap.totals.companies,
    'Contacts': snap.totals.contacts,
    'Deals (seeded)': snap.totals.deals,
    'Acquisition deals': snap.totals.acquisition,
    'Placement deals': snap.totals.placements,
    'Tickets': snap.totals.tickets,
    'Open tickets': snap.totals.openTickets,
    'SLA-breached tickets': snap.tickets.slaBreached,
    'Closed-won value': Math.round(snap.revenue.wonTotal),
    'Acquisition win rate': +snap.revenue.acqWinRate.toFixed(3),
    'Acquisition won': snap.revenue.acqWon,
    'Acquisition lost': snap.revenue.acqLost,
    'Acquisition open': snap.revenue.acqOpen,
    'Delivered placement value': Math.round(snap.revenue.deliveredValue),
    'Placements scoring < 60': placements.filter(p => (+p.properties.zia_health_score || 0) < 60).length,
    'Placements flagged At Risk': snap.placements.atRisk,
    'Active placements': snap.placements.active,
    'Average health score': +snap.placements.avgHealth.toFixed(1),
    'Invoices': inv.length,
    'Collected': Math.round(snap.invoicing.collected),
    'Outstanding': Math.round(snap.invoicing.outstanding),
    'Invoices 90+ days past due': snap.invoicing.agingBuckets['90+ days'],
    'Past-due invoice population': pastDue.length,
    'Unpaid invoices (sent + overdue)': unpaid.length,
    '  …of those, 90+ days': over90(unpaid).length,
    '  …worth': amountOf(over90(unpaid)),
    'Average days to pay': +snap.invoicing.avgDaysToPay.toFixed(1),
    'Quotes': quotes.length,
    'Line items': lineItems.length,
    'Discounted line items': lineItems.filter(l => +l.properties.hs_discount_percentage > 0).length,
    'Products': products.length,
    'Custom zia_ properties': customProperties,
    'Deal objects (incl. sample)': deals.length,
    'Documents attached': files,
    'Lead capture forms': (forms.results || []).length,
    'Segments / lists': lists.total,
    'Deals with no company link': seeded.filter(d => !(dc.get(String(d.id)) || []).length).length,
    'Placements with no talent link': placements.filter(d => !(dct.get(String(d.id)) || []).length).length,
  };

  let src = fs.readFileSync(FILE, 'utf8');
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let changed = 0;

  for (const [label, value] of Object.entries(next)) {
    const re = new RegExp(`(\\['${esc(label)}',\\s*)([0-9.]+)`);
    const m = src.match(re);
    if (!m) { console.log(`  MISS  ${label}`); continue; }
    if (m[2] === String(value)) continue;
    console.log(`  ${label.padEnd(34)} ${m[2].padStart(12)}  ->  ${value}`);
    src = src.replace(re, `$1${value}`);
    changed++;
  }

  console.log(`\n${changed} claim(s) would change.`);
  if (!APPLY) { console.log('dry run — re-run with --apply to write validate.js.'); return; }
  fs.writeFileSync(FILE, src);
  console.log('validate.js re-baselined.');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
