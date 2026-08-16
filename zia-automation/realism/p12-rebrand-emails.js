'use strict';
/**
 * P12 — move consultant emails onto the ZIA domain.
 *
 * The reskin (P0) renamed the business to ZIA but left every consultant on
 * @lumentalent.com, the pre-reskin brand. That inconsistency is also what caused
 * the P11 bug: HubSpot auto-associates contacts to companies by email domain, and
 * the company owning lumentalent.com had been reskinned into a client.
 *
 * The email is a foreign key here, not just a label. It is denormalised onto:
 *   - contact.email                (the record itself)
 *   - deal.zia_talent_email        (which consultant is on which placement)
 *   - ticket.zia_talent_email      (which consultant a ticket concerns)
 *
 * All three move together or the placement-to-consultant link silently breaks.
 * That is the whole point of this script — a rename is a referential-integrity
 * problem, not a cosmetic one.
 *
 * Idempotent: anything already on the new domain is skipped.
 *
 *   node realism/p12-rebrand-emails.js --dry-run
 *   node realism/p12-rebrand-emails.js
 */
const { api, listAll, batch } = require('../lib/hubspot');

const OLD_DOMAIN = 'lumentalent.com';
const NEW_DOMAIN = 'ziaod.com';

const swap = email => {
  const [local, domain] = String(email || '').split('@');
  if (!local || !domain) return null;
  if (domain.toLowerCase() !== OLD_DOMAIN) return null;
  return `${local}@${NEW_DOMAIN}`;
};

module.exports = async function p12({ dryRun }) {
  // ---- 1. the contacts ----
  const contacts = await listAll('contacts', ['email', 'zia_contact_type']);
  const talent = contacts.filter(c => c.properties.zia_contact_type === 'talent');

  const remap = new Map();               // old email -> new email
  const contactUpdates = [];
  for (const c of talent) {
    const next = swap(c.properties.email);
    if (!next) continue;
    remap.set(c.properties.email.toLowerCase(), next);
    contactUpdates.push({ id: c.id, properties: { email: next } });
  }

  const alreadyDone = talent.filter(c => (c.properties.email || '').endsWith('@' + NEW_DOMAIN)).length;
  console.log(`  consultants: ${talent.length}  already on ${NEW_DOMAIN}: ${alreadyDone}  to move: ${contactUpdates.length}`);

  // ---- 2. the deals that reference them ----
  const deals = await listAll('deals', ['zia_talent_email', 'zia_placement_status']);
  const dealUpdates = [];
  for (const d of deals) {
    const cur = (d.properties.zia_talent_email || '').toLowerCase();
    if (!cur) continue;
    const next = remap.get(cur) || swap(cur);
    if (next && next.toLowerCase() !== cur) dealUpdates.push({ id: d.id, properties: { zia_talent_email: next } });
  }
  console.log(`  placement deals referencing a consultant email: ${dealUpdates.length} to rewrite`);

  // ---- 3. the tickets that reference them ----
  const tickets = await listAll('tickets', ['zia_talent_email']);
  const ticketUpdates = [];
  for (const t of tickets) {
    const cur = (t.properties.zia_talent_email || '').toLowerCase();
    if (!cur) continue;
    const next = remap.get(cur) || swap(cur);
    if (next && next.toLowerCase() !== cur) ticketUpdates.push({ id: t.id, properties: { zia_talent_email: next } });
  }
  console.log(`  tickets referencing a consultant email: ${ticketUpdates.length} to rewrite`);

  if (dryRun) {
    return {
      ok: true, dryRun: true,
      wouldWrite: { contacts: contactUpdates.length, deals: dealUpdates.length, tickets: ticketUpdates.length },
      sample: contactUpdates.slice(0, 3).map(u => u.properties.email),
    };
  }

  // ---- write ----
  // Contacts first: email is the identity here, so if anything fails it must fail
  // before the references are rewritten, not after.
  const c = await batch('contacts', 'update', contactUpdates);
  console.log(`  contacts: ${c.ok} updated, ${c.failed} failed`);
  if (c.failed) {
    console.error('  ! contact updates failed — stopping before rewriting references');
    return { ok: false, contacts: c };
  }

  const d = await batch('deals', 'update', dealUpdates);
  console.log(`  deals: ${d.ok} updated, ${d.failed} failed`);

  const t = await batch('tickets', 'update', ticketUpdates);
  console.log(`  tickets: ${t.ok} updated, ${t.failed} failed`);

  // ---- 4. the employer company domain, so the auto-matcher agrees ----
  const companies = await listAll('companies', ['name', 'domain']);
  const employer = companies.find(x => x.properties.name === 'ZIA Organizational Development');
  if (employer && employer.properties.domain !== NEW_DOMAIN) {
    await api('PATCH', `/crm/v3/objects/companies/${employer.id}`, {
      properties: { domain: NEW_DOMAIN, website: `https://www.${NEW_DOMAIN}` },
    });
    console.log(`  employer company domain -> ${NEW_DOMAIN}`);
  }

  return { ok: true, contacts: c.ok, deals: d.ok, tickets: t.ok };
};

if (require.main === module) {
  module.exports({ dryRun: process.argv.includes('--dry-run') })
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error(e); process.exit(1); });
}
