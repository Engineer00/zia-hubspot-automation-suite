#!/usr/bin/env node
'use strict';
/**
 * P25 — put people on deals, and clear what the rescale left behind.
 *
 * THREE DEFECTS, ALL VISIBLE ON THE FIRST RECORD SOMEONE OPENS
 *
 * 1. **280 of 659 deals have no contact.** A deal with nobody on it has no buyer —
 *    open it in HubSpot and the Contacts card reads (0). In a two-sided business the
 *    join between the account and the person is the whole point of the CRM.
 *
 * 2. **Client buyers have zero activity.** P5 attached engagements to each deal's
 *    FIRST associated contact, which for a delivery engagement is the consultant. The
 *    166 people who actually buy have empty timelines — and it is why WF-09's recency
 *    signal had to be sourced from deals rather than contacts.
 *
 * 3. **Orphans.** The rescale archived 1,062 deals but left their quotes and
 *    engagements behind: 417 quotes and thousands of activities now attach to nothing.
 *    They are invisible on the dashboard and inflate every object count.
 *
 *   node realism/p25-relationships.js            dry run
 *   node realism/p25-relationships.js --apply    fix
 */
const { api, listAll, readAssociations, ASSOC, STAGE } = require('../lib/hubspot');

const APPLY = process.argv.includes('--apply');
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

(async () => {
  console.log('pulling...');
  const companies = await listAll('companies', ['name']);
  const contacts = await listAll('contacts', ['email', 'zia_contact_type']);
  const deals = await listAll('deals', ['dealname', 'zia_deal_type', 'zia_placement_status', 'dealstage']);
  const seeded = deals.filter(d => d.properties.zia_deal_type);
  const liveDeals = new Set(deals.map(d => String(d.id)));

  const dealCompany = await readAssociations('deals', 'companies', seeded.map(d => d.id));
  const dealContact = await readAssociations('deals', 'contacts', seeded.map(d => d.id));
  const companyContact = await readAssociations('companies', 'contacts', companies.map(c => c.id));
  const clientIds = new Set(contacts.filter(c => c.properties.zia_contact_type === 'client_contact').map(c => String(c.id)));

  // ---- 1. every deal gets the buyer from its own company --------------------
  const needContact = seeded.filter(d => !(dealContact.get(String(d.id)) || []).length);
  const links = [];
  let noBuyer = 0;
  for (const d of needContact) {
    const co = (dealCompany.get(String(d.id)) || [])[0];
    if (!co) { noBuyer++; continue; }
    const buyer = (companyContact.get(String(co)) || []).find(id => clientIds.has(String(id)));
    if (!buyer) { noBuyer++; continue; }
    links.push({
      from: { id: d.id }, to: { id: String(buyer) },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.DEAL_TO_CONTACT }],
    });
  }
  console.log(`\n1. deals with no contact : ${needContact.length}`);
  console.log(`   can be linked to a buyer: ${links.length}`);
  console.log(`   company has no buyer    : ${noBuyer}  (lost/dormant accounts — correct to leave)`);

  // ---- 2. give client buyers the activity from their own deals --------------
  // Rather than invent new engagements, associate the ones that already exist on a
  // buyer's deals to the buyer as well. The history is real; it was simply never
  // attached to the person.
  const notes = await listAll('notes', ['hs_note_body']);
  const calls = await listAll('calls', ['hs_call_title']);
  const meetings = await listAll('meetings', ['hs_meeting_title']);
  const ENG = [
    ['notes', notes, 202], ['calls', calls, 194], ['meetings', meetings, 200],
  ];

  // buyer for each deal, after step 1
  const buyerOfDeal = new Map();
  for (const d of seeded) {
    const existing = (dealContact.get(String(d.id)) || []).find(id => clientIds.has(String(id)));
    if (existing) buyerOfDeal.set(String(d.id), String(existing));
  }
  for (const l of links) buyerOfDeal.set(String(l.from.id), String(l.to.id));

  const engLinks = [];
  const orphanEng = { notes: [], calls: [], meetings: [] };
  for (const [name, rows, typeId] of ENG) {
    const toDeals = await readAssociations(name, 'deals', rows.map(r => r.id));
    const toContacts = await readAssociations(name, 'contacts', rows.map(r => r.id));
    for (const r of rows) {
      const ds = (toDeals.get(String(r.id)) || []).filter(id => liveDeals.has(String(id)));
      if (!ds.length) { orphanEng[name].push(r); continue; }
      const already = new Set((toContacts.get(String(r.id)) || []).map(String));
      for (const d of ds) {
        const buyer = buyerOfDeal.get(String(d));
        if (buyer && !already.has(buyer)) {
          engLinks.push({
            from: { id: r.id }, to: { id: buyer },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: typeId }],
          });
          already.add(buyer);
        }
      }
    }
  }
  console.log(`\n2. engagements to attach to buyers: ${engLinks.length}`);

  // ---- 3. orphans -----------------------------------------------------------
  const quotes = await listAll('quotes', ['hs_title']);
  const quoteDeal = await readAssociations('quotes', 'deals', quotes.map(q => q.id));
  const orphanQuotes = quotes.filter(q =>
    !(quoteDeal.get(String(q.id)) || []).some(id => liveDeals.has(String(id))));

  const orphanTotal = orphanQuotes.length
    + orphanEng.notes.length + orphanEng.calls.length + orphanEng.meetings.length;
  console.log(`\n3. orphans left by the rescale:`);
  console.log(`   quotes   ${orphanQuotes.length} of ${quotes.length}`);
  console.log(`   notes    ${orphanEng.notes.length} of ${notes.length}`);
  console.log(`   calls    ${orphanEng.calls.length} of ${calls.length}`);
  console.log(`   meetings ${orphanEng.meetings.length} of ${meetings.length}`);
  console.log(`   total to archive: ${orphanTotal}`);

  if (!APPLY) { console.log('\ndry run — re-run with --apply.'); return; }

  const assoc = async (from, to, inputs, label) => {
    if (!inputs.length) return;
    let ok = 0;
    for (const c of chunk(inputs, 100)) {
      try { await api('POST', `/crm/v4/associations/${from}/${to}/batch/create`, { inputs: c }); ok += c.length; }
      catch (e) { console.error(`   ! ${label}: ${e.message.slice(0, 120)}`); }
    }
    console.log(`   ${label.padEnd(28)} ${ok}`);
  };
  const archive = async (object, rows, label) => {
    if (!rows.length) return;
    let ok = 0;
    for (const c of chunk(rows, 100)) {
      try { await api('POST', `/crm/v3/objects/${object}/batch/archive`, { inputs: c.map(r => ({ id: r.id })) }); ok += c.length; }
      catch (e) { console.error(`   ! ${label}: ${e.message.slice(0, 120)}`); }
    }
    console.log(`   ${label.padEnd(28)} ${ok}`);
  };

  console.log('\nwriting:');
  await assoc('deals', 'contacts', links, 'deal -> buyer');
  for (const [name] of ENG) {
    const subset = engLinks.filter(l => notes.some(n => String(n.id) === String(l.from.id)) === (name === 'notes'));
    // grouped per object type below instead
  }
  await assoc('notes', 'contacts', engLinks.filter(l => notes.some(n => String(n.id) === String(l.from.id))), 'note -> buyer');
  await assoc('calls', 'contacts', engLinks.filter(l => calls.some(n => String(n.id) === String(l.from.id))), 'call -> buyer');
  await assoc('meetings', 'contacts', engLinks.filter(l => meetings.some(n => String(n.id) === String(l.from.id))), 'meeting -> buyer');
  await archive('quotes', orphanQuotes, 'orphaned quotes');
  await archive('notes', orphanEng.notes, 'orphaned notes');
  await archive('calls', orphanEng.calls, 'orphaned calls');
  await archive('meetings', orphanEng.meetings, 'orphaned meetings');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
