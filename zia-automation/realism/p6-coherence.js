'use strict';
/**
 * P6 — relational coherence + commercial realism.
 *
 * Two problems this fixes:
 *
 * 1. DEALS HAVE NO BUYER. The seed generator placed contacts and deals on largely
 *    different companies, so most deals show "Contacts (0)". No real CRM looks like
 *    that — a deal always has a human on the other side. We reassign client contacts
 *    onto companies that actually have deals, repoint their email domain to match,
 *    and associate them to those deals.
 *
 * 2. NOBODY PAYS LIST PRICE. Every line item currently sits at list. Real B2B has a
 *    discount distribution. We apply one to a realistic subset and reconcile the deal
 *    amount to the discounted total, so deal value and line items agree.
 *
 * Quotes / invoices / payments are NOT available on this tier (all 400), so the
 * commercial story stops at line-item level, which is where it can be honest.
 */
const { api, listAll, batch, readAssociations, ASSOC } = require('../lib/hubspot');
const { rng, weighted, pick } = require('./lib');

const CT_CO = [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.CONTACT_TO_COMPANY }];
const DEAL_CT = [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.DEAL_TO_CONTACT }];

const slug = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

module.exports = async function p6({ dryRun }) {
  /* ================= 1. give deals a buyer ================= */
  const deals = await listAll('deals', ['dealname', 'zia_deal_type', 'zia_placement_status', 'amount']);
  const seeded = deals.filter(d => d.properties.zia_deal_type);
  const acq = seeded.filter(d => !d.properties.zia_placement_status);

  const dealCo = await readAssociations('deals', 'companies', seeded.map(d => d.id));

  // companies that have at least one acquisition deal, busiest first
  const coDeals = new Map();
  for (const d of acq) {
    for (const co of dealCo.get(d.id) || []) {
      if (!coDeals.has(co)) coDeals.set(co, []);
      coDeals.get(co).push(d.id);
    }
  }
  const ranked = [...coDeals.entries()].sort((a, b) => b[1].length - a[1].length);
  console.log(`  companies with acquisition deals: ${ranked.length}`);

  const companies = await listAll('companies', ['name', 'domain']);
  const coInfo = new Map(companies.map(c => [c.id, c.properties]));

  const contacts = await listAll('contacts', ['email', 'firstname', 'lastname', 'zia_contact_type']);
  const clients = contacts.filter(c => c.properties.zia_contact_type === 'client_contact');
  console.log(`  client contacts: ${clients.length}`);

  // current contact -> company, so we only move the ones that need moving
  const ctCo = await readAssociations('contacts', 'companies', clients.map(c => c.id));

  const assign = [];          // { contact, company }
  for (let i = 0; i < clients.length; i++) {
    const target = ranked[i % ranked.length][0];
    assign.push({ contact: clients[i], company: target });
  }

  // re-point emails onto the new company's domain
  const takenEmail = new Set(contacts.map(c => (c.properties.email || '').toLowerCase()));
  const emailUpdates = [], assocCreate = [], assocRemove = [];

  for (const { contact, company } of assign) {
    const info = coInfo.get(company);
    if (!info || !info.domain) continue;
    const current = (ctCo.get(contact.id) || [])[0];
    if (current === company) continue;   // already right

    const f = slug(contact.properties.firstname) || 'contact';
    const l = slug(contact.properties.lastname) || contact.id.slice(-4);
    let email = `${f}.${l}@${info.domain}`, n = 1;
    while (takenEmail.has(email)) email = `${f}.${l}${++n}@${info.domain}`;
    takenEmail.add(email);
    takenEmail.delete((contact.properties.email || '').toLowerCase());

    emailUpdates.push({ id: contact.id, properties: { email } });
    assocCreate.push({ from: { id: contact.id }, to: { id: company }, types: CT_CO });
    if (current) assocRemove.push({ contactId: contact.id, companyId: current });
  }

  console.log(`  contacts to reassign: ${assocCreate.length}`);
  const eRes = await batch('contacts', 'update', emailUpdates, { dryRun });
  console.log(`  emails repointed: ${eRes.ok || eRes.wouldWrite || 0}`);

  let assocOk = 0;
  if (!dryRun) {
    for (let i = 0; i < assocCreate.length; i += 100) {
      try {
        await api('POST', '/crm/v4/associations/contacts/companies/batch/create', { inputs: assocCreate.slice(i, i + 100) });
        assocOk += Math.min(100, assocCreate.length - i);
      } catch (e) { console.log(`    ! contact->company assoc failed: ${e.message.slice(0, 180)}`); }
    }
    // drop the stale primary so each contact reads against one employer
    for (let i = 0; i < assocRemove.length; i += 100) {
      try {
        await api('POST', '/crm/v4/associations/contacts/companies/batch/archive', {
          inputs: assocRemove.slice(i, i + 100).map(x => ({ from: { id: x.contactId }, to: [{ id: x.companyId }] })),
        });
      } catch (e) { console.log(`    ! stale assoc archive failed: ${e.message.slice(0, 180)}`); }
    }
  }
  console.log(`  contact->company associations: ${dryRun ? assocCreate.length + ' (dry)' : assocOk}`);

  // now attach those contacts to the deals at their company
  const contactByCompany = new Map();
  for (const { contact, company } of assign) {
    if (!contactByCompany.has(company)) contactByCompany.set(company, []);
    contactByCompany.get(company).push(contact.id);
  }

  const dealContactPairs = [];
  for (const d of acq) {
    for (const co of dealCo.get(d.id) || []) {
      for (const ctId of (contactByCompany.get(co) || []).slice(0, 2)) {
        dealContactPairs.push({ from: { id: d.id }, to: { id: ctId }, types: DEAL_CT });
      }
    }
  }
  console.log(`  deal->contact links to create: ${dealContactPairs.length}`);

  let dcOk = 0;
  if (!dryRun) {
    for (let i = 0; i < dealContactPairs.length; i += 100) {
      try {
        await api('POST', '/crm/v4/associations/deals/contacts/batch/create', { inputs: dealContactPairs.slice(i, i + 100) });
        dcOk += Math.min(100, dealContactPairs.length - i);
      } catch (e) { console.log(`    ! deal->contact assoc failed: ${e.message.slice(0, 180)}`); }
    }
  }

  /* ================= 2. discounts ================= */
  const lineItems = await listAll('line_items', ['name', 'price', 'quantity', 'amount', 'hs_discount_percentage']);
  const liDeal = await readAssociations('line_items', 'deals', lineItems.map(l => l.id));

  const liUpdates = [], dealAmount = new Map();
  const dist = {};
  for (const li of lineItems) {
    const r = rng('disc:' + li.id);
    // most deals go out at list; a realistic minority are discounted
    const disc = weighted(r, [[0, 62], [5, 12], [10, 13], [15, 8], [20, 5]]);
    dist[disc + '%'] = (dist[disc + '%'] || 0) + 1;
    if (!disc) continue;

    const price = +li.properties.price || 0;
    const qty = +li.properties.quantity || 1;
    const gross = price * qty;
    const net = Math.round(gross * (1 - disc / 100));

    liUpdates.push({ id: li.id, properties: { hs_discount_percentage: String(disc) } });
    for (const dId of liDeal.get(li.id) || []) dealAmount.set(dId, net);
  }

  console.log(`  discount distribution: ${JSON.stringify(dist)}`);
  console.log(`  line items to discount: ${liUpdates.length}`);
  const liRes = await batch('line_items', 'update', liUpdates, { dryRun });

  const dealUpdates = [...dealAmount].map(([id, amt]) => ({ id, properties: { amount: String(amt) } }));
  console.log(`  deal amounts to reconcile: ${dealUpdates.length}`);
  const dRes = await batch('deals', 'update', dealUpdates, { dryRun });

  return {
    contactsReassigned: eRes.ok, contactCompanyLinks: dryRun ? undefined : assocOk,
    dealContactLinks: dryRun ? dealContactPairs.length : dcOk,
    lineItemsDiscounted: liRes.ok, dealAmountsReconciled: dRes.ok,
    failed: eRes.failed + liRes.failed + dRes.failed,
  };
};
