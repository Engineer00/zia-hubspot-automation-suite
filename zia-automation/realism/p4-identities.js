'use strict';
/**
 * P4 — real identities.
 *
 * talent0@lumentalent.com is the loudest "this is fake" signal in the portal.
 * The real first and last names are already on the contact records, so rebuild
 * the address from them (first.last@lumentalent.com, deduped), then repoint the
 * zia_talent_email field on the 500 placement deals so the link still resolves.
 */
const { listAll, batch } = require('../lib/hubspot');

const slug = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

module.exports = async function p4({ dryRun }) {
  const contacts = await listAll('contacts', ['email', 'firstname', 'lastname', 'zia_contact_type']);
  const talent = contacts.filter(c => c.properties.zia_contact_type === 'talent');
  console.log(`  talent contacts: ${talent.length}`);

  const taken = new Set(contacts.map(c => (c.properties.email || '').toLowerCase()));
  const remap = new Map();   // old email -> new email
  const updates = [];

  for (const c of talent) {
    const old = (c.properties.email || '').toLowerCase();
    if (!/^talent\d+@/.test(old)) continue;   // already realistic

    const f = slug(c.properties.firstname), l = slug(c.properties.lastname);
    if (!f || !l) continue;

    let email = `${f}.${l}@lumentalent.com`;
    let n = 1;
    while (taken.has(email)) email = `${f}.${l}${++n}@lumentalent.com`;
    taken.add(email);
    taken.delete(old);

    remap.set(old, email);
    updates.push({ id: c.id, properties: { email } });
  }

  console.log(`  contacts to rename: ${updates.length}`);
  const cRes = await batch('contacts', 'update', updates, { dryRun });

  // repoint the placement deals
  const deals = await listAll('deals', ['zia_talent_email', 'zia_placement_status']);
  const placements = deals.filter(d => d.properties.zia_placement_status && d.properties.zia_talent_email);
  const dealUpdates = [];
  let unmatched = 0;
  for (const d of placements) {
    const next = remap.get((d.properties.zia_talent_email || '').toLowerCase());
    if (next) dealUpdates.push({ id: d.id, properties: { zia_talent_email: next } });
    else unmatched++;
  }
  console.log(`  placement deals to repoint: ${dealUpdates.length}  (unmatched: ${unmatched})`);
  const dRes = await batch('deals', 'update', dealUpdates, { dryRun });

  // and the tickets that carry the talent email
  const tickets = await listAll('tickets', ['zia_talent_email', 'zia_ticket_type']);
  const tUpdates = [];
  for (const t of tickets) {
    const next = remap.get((t.properties.zia_talent_email || '').toLowerCase());
    if (next) tUpdates.push({ id: t.id, properties: { zia_talent_email: next } });
  }
  console.log(`  tickets to repoint: ${tUpdates.length}`);
  const tRes = await batch('tickets', 'update', tUpdates, { dryRun });

  return {
    contactsRenamed: cRes.ok, dealsRepointed: dRes.ok, ticketsRepointed: tRes.ok,
    failed: cRes.failed + dRes.failed + tRes.failed,
    wouldWrite: (cRes.wouldWrite || 0) + (dRes.wouldWrite || 0) + (tRes.wouldWrite || 0),
  };
};
