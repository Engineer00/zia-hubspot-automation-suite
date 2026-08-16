#!/usr/bin/env node
'use strict';
/**
 * P19 — rescale the portal to a human-sized consultancy.
 *
 * WHY
 * 1,098 organizations is a realistic CRM *database*, but it reads as a data dump rather
 * than a business you could picture. At ~225 organizations the whole thing becomes
 * legible: a reviewer can believe one team runs it, and every number stays big enough
 * to carry a finding.
 *
 * WHAT MAKES THIS COHERENT RATHER THAN JUST SMALLER
 * Shrinking companies alone would leave 12 deals per company. Every object has to come
 * down together, keeping the ratios that make the story work:
 *
 *   organizations      1,098  ->  ~225
 *   acquisition deals  1,000  ->  ~400   (~1.8 per org)
 *   delivery engagem.    500  ->  ~200
 *   consultants          400  ->  ~160
 *   client contacts      593  ->  ~225
 *
 * SELECTION — keep the richest records, not a random slice
 * Companies are ranked by how much story they carry: a live delivery engagement, an
 * invoice, tickets, an NPS response, a won deal. The survivors are the ones you can
 * actually click into during a demo. Funnel proportions are preserved deliberately —
 * a CRM of nothing but customers is its own kind of fake, so prospects, lost deals and
 * a few dormant records are kept in realistic ratio.
 *
 * SAFETY
 * Deletion is archival in HubSpot — records are restorable for 90 days. Nothing is
 * removed until --apply, and the dry run prints the full plan.
 *
 *   node realism/p19-rescale.js            dry run — prints the plan, writes nothing
 *   node realism/p19-rescale.js --apply    perform the rescale
 */
const { api, listAll, batch, readAssociations, STAGE } = require('../lib/hubspot');

const APPLY = process.argv.includes('--apply');
const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? +process.argv[i + 1] : dflt;
};

const TARGET_COMPANIES = argOf('--companies', 225);
const TARGET_TALENT = argOf('--talent', 160);

// Funnel mix to preserve. A CRM of pure customers is as unrealistic as one of pure noise.
const MIX = { client: 0.49, prospect: 0.18, lost: 0.24, dormant: 0.09 };

const pct = (n, d) => d ? (n / d * 100).toFixed(1) + '%' : '—';

(async () => {
  console.log('pulling the portal...');
  const [companies, deals, contacts, tickets] = await Promise.all([
    listAll('companies', ['name', 'domain', 'zia_industry', 'zia_nps_avg']),
    listAll('deals', ['dealname', 'amount', 'dealstage', 'zia_deal_type', 'zia_placement_status',
      'zia_invoice_status', 'zia_health_score', 'zia_talent_email']),
    listAll('contacts', ['email', 'zia_contact_type', 'zia_nps_score', 'zia_bench_status']),
    listAll('tickets', ['subject', 'zia_ticket_type']),
  ]);
  const seeded = deals.filter(d => d.properties.zia_deal_type);

  const dealCo = await readAssociations('deals', 'companies', seeded.map(d => d.id));
  const contactCo = await readAssociations('contacts', 'companies', contacts.map(c => c.id));
  const ticketDeal = await readAssociations('tickets', 'deals', tickets.map(t => t.id));
  const ticketContact = await readAssociations('tickets', 'contacts', tickets.map(t => t.id));

  // ---- profile every company ---------------------------------------------
  const profile = new Map();
  for (const c of companies) profile.set(String(c.id), { won: 0, lost: 0, open: 0, delivery: 0, invoices: 0, tickets: 0, nps: 0, value: 0 });
  for (const d of seeded) {
    for (const co of dealCo.get(String(d.id)) || []) {
      const p = profile.get(String(co)); if (!p) continue;
      if (d.properties.zia_placement_status) p.delivery++;
      else if (d.properties.dealstage === STAGE.WON) p.won++;
      else if (d.properties.dealstage === STAGE.LOST) p.lost++;
      else p.open++;
      if (d.properties.zia_invoice_status) p.invoices++;
      p.value += +d.properties.amount || 0;
    }
  }
  const dealToCo = new Map();
  for (const d of seeded) dealToCo.set(String(d.id), (dealCo.get(String(d.id)) || [])[0]);
  for (const t of tickets) {
    for (const dl of ticketDeal.get(String(t.id)) || []) {
      const co = dealToCo.get(String(dl)); if (!co) continue;
      const p = profile.get(String(co)); if (p) p.tickets++;
    }
  }
  for (const c of contacts) {
    if (c.properties.zia_nps_score === null || c.properties.zia_nps_score === undefined || c.properties.zia_nps_score === '') continue;
    for (const co of contactCo.get(String(c.id)) || []) {
      const p = profile.get(String(co)); if (p) p.nps++;
    }
  }

  // ---- bucket + rank ------------------------------------------------------
  const bucketOf = p => (p.won > 0 || p.delivery > 0) ? 'client'
    : p.open > 0 ? 'prospect'
      : p.lost > 0 ? 'lost' : 'dormant';
  // Richness: what makes a record worth clicking into during a demo.
  const richness = p => p.delivery * 6 + p.invoices * 4 + p.tickets * 2 + p.nps * 5 + p.won * 3 + p.open * 2 + p.lost;

  const buckets = { client: [], prospect: [], lost: [], dormant: [] };
  for (const c of companies) {
    const p = profile.get(String(c.id));
    buckets[bucketOf(p)].push({ c, p, score: richness(p) });
  }
  for (const k of Object.keys(buckets)) buckets[k].sort((a, b) => b.score - a.score || b.p.value - a.p.value);

  const keepIds = new Set();
  const plan = {};
  for (const [k, share] of Object.entries(MIX)) {
    const want = Math.round(TARGET_COMPANIES * share);
    const take = buckets[k].slice(0, want);
    plan[k] = { want, available: buckets[k].length, taken: take.length };
    for (const t of take) keepIds.add(String(t.c.id));
  }
  // The ZIA operating company is not a client and must survive — consultants hang off it.
  const zia = companies.find(c => /^ZIA\b/i.test(c.properties.name || ''));
  if (zia) keepIds.add(String(zia.id));

  console.log('\n=== COMPANY SELECTION ===');
  console.log('bucket      available   keeping');
  for (const [k, v] of Object.entries(plan)) {
    console.log(`  ${k.padEnd(10)} ${String(v.available).padStart(8)} ${String(v.taken).padStart(9)}`);
  }
  console.log(`  ${'ZIA (ops)'.padEnd(10)} ${'1'.padStart(8)} ${(zia ? 1 : 0).toString().padStart(9)}`);
  console.log(`  TOTAL keeping: ${keepIds.size} of ${companies.length}`);

  // ---- deals ---------------------------------------------------------------
  const keepDeals = new Set(), dropDeals = [];
  for (const d of seeded) {
    const co = (dealCo.get(String(d.id)) || [])[0];
    if (co && keepIds.has(String(co))) keepDeals.add(String(d.id)); else dropDeals.push(d);
  }
  const keptAcq = [...keepDeals].filter(id => {
    const d = seeded.find(x => String(x.id) === id); return d && !d.properties.zia_placement_status;
  }).length;
  const keptDel = keepDeals.size - keptAcq;

  // ---- consultants ---------------------------------------------------------
  const talent = contacts.filter(c => c.properties.zia_contact_type === 'talent');
  const clientContacts = contacts.filter(c => c.properties.zia_contact_type === 'client_contact');
  // Consultants attached to a surviving engagement are kept first.
  const neededEmails = new Set();
  for (const d of seeded) {
    if (!keepDeals.has(String(d.id))) continue;
    if (d.properties.zia_talent_email) neededEmails.add(d.properties.zia_talent_email);
  }
  const talentKeep = [], talentDrop = [];
  for (const t of talent) {
    if (neededEmails.has(t.properties.email)) talentKeep.push(t); else talentDrop.push(t);
  }
  // Top up to the target with bench so the supply side still has slack to report on.
  while (talentKeep.length < TARGET_TALENT && talentDrop.length) talentKeep.push(talentDrop.shift());

  // ---- client contacts -----------------------------------------------------
  const ccKeep = [], ccDrop = [];
  for (const c of clientContacts) {
    const cos = contactCo.get(String(c.id)) || [];
    (cos.some(co => keepIds.has(String(co))) ? ccKeep : ccDrop).push(c);
  }

  // ---- tickets -------------------------------------------------------------
  const keepContactIds = new Set([...talentKeep, ...ccKeep].map(c => String(c.id)));
  const tkKeep = [], tkDrop = [];
  for (const t of tickets) {
    const dls = ticketDeal.get(String(t.id)) || [];
    const cts = ticketContact.get(String(t.id)) || [];
    const linked = dls.some(d => keepDeals.has(String(d))) || cts.some(c => keepContactIds.has(String(c)));
    (linked ? tkKeep : tkDrop).push(t);
  }

  const companyDrop = companies.filter(c => !keepIds.has(String(c.id)));

  console.log('\n=== RESCALE PLAN ===');
  const row = (label, before, after) =>
    console.log(`  ${label.padEnd(22)} ${String(before).padStart(6)}  ->  ${String(after).padStart(6)}   (removing ${before - after}, ${pct(before - after, before)})`);
  row('Organizations', companies.length, keepIds.size);
  row('Acquisition deals', seeded.filter(d => !d.properties.zia_placement_status).length, keptAcq);
  row('Delivery engagements', seeded.filter(d => d.properties.zia_placement_status).length, keptDel);
  row('Consultants', talent.length, talentKeep.length);
  row('Client contacts', clientContacts.length, ccKeep.length);
  row('Tickets', tickets.length, tkKeep.length);
  console.log(`\n  contacts after rescale: ${talentKeep.length + ccKeep.length} `
    + `(free-tier ceiling is 1,000 — ${1000 - (talentKeep.length + ccKeep.length)} slots free)`);

  const keptValue = seeded.filter(d => keepDeals.has(String(d.id)) && d.properties.dealstage === STAGE.WON)
    .reduce((a, d) => a + (+d.properties.amount || 0), 0);
  console.log(`  closed-won value retained: $${Math.round(keptValue).toLocaleString()}`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing deleted.');
    console.log(`Would archive: ${companyDrop.length} companies · ${dropDeals.length} deals · `
      + `${talentDrop.length} consultants · ${ccDrop.length} client contacts · ${tkDrop.length} tickets`);
    console.log('Re-run with --apply to perform it. HubSpot keeps deletions restorable for 90 days.');
    return;
  }

  // ---- apply: delete children before parents -------------------------------
  const archive = async (object, rows, label) => {
    if (!rows.length) { console.log(`  ${label}: nothing to remove`); return; }
    let ok = 0, failed = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100).map(r => ({ id: r.id }));
      try { await api('POST', `/crm/v3/objects/${object}/batch/archive`, { inputs: chunk }); ok += chunk.length; }
      catch (e) { failed += chunk.length; console.error(`    ! ${label} chunk failed: ${e.message.slice(0, 160)}`); }
    }
    console.log(`  ${label.padEnd(18)} archived ${ok}  failed ${failed}`);
  };

  await archive('tickets', tkDrop, 'tickets');
  await archive('deals', dropDeals, 'deals');
  await archive('contacts', [...talentDrop, ...ccDrop], 'contacts');
  await archive('companies', companyDrop, 'companies');

  console.log('\nRescale complete. Now run:');
  console.log('  node engine.js            # reconcile the smaller portal');
  console.log('  node snapshot.js && node build-dashboard.js && node validate.js');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
