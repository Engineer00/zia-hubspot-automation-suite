#!/usr/bin/env node
'use strict';
/**
 * P24 — align company domains (and the emails built from them) with company names.
 *
 * THE DEFECT
 * P15 repaired company NAMES that carried a dedupe counter, but not their DOMAINS.
 * The portal ended up with records like:
 *
 *     name  Marlow Technologies      domain  lindenlabs39.com
 *     name  Ashgrove Fabrication     domain  tilburymanufacturing89.com
 *
 * Both halves of the tell survive: the domain still carries the counter, and it names
 * a different company than the record does. Anyone opening a company record sees it
 * immediately.
 *
 * WHY THE EMAILS HAVE TO MOVE TOO
 * Client contact emails are built from the company domain, and HubSpot auto-associates
 * contacts to companies by email domain. Changing one without the other would leave
 * contacts pointing at a domain no company owns — trading a cosmetic defect for a
 * structural one.
 *
 *   node realism/p24-domain-repair.js            dry run
 *   node realism/p24-domain-repair.js --apply    repair domains + emails
 */
const { listAll, batch, readAssociations } = require('../lib/hubspot');

const APPLY = process.argv.includes('--apply');

const slug = s => (s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const baseOf = d => (d || '').replace(/\.(com|io|net|org|co|group)$/i, '');

(async () => {
  const companies = await listAll('companies', ['name', 'domain']);
  const contacts = await listAll('contacts', ['email', 'firstname', 'lastname', 'zia_contact_type']);
  const contactCompany = await readAssociations('contacts', 'companies', contacts.map(c => c.id));

  /**
   * A domain is wrong when it does not derive from the company's own name — but
   * "derive" has to include ABBREVIATION, or this rule destroys real branding.
   *
   * It did exactly that on the first run: ZIA Organizational Development owns
   * `ziaod.com`, the rule decided that did not spell out the full name, rewrote it to
   * `ziaorganizationaldevelopment.com`, and dragged all 187 consultant emails with it.
   * `ziaod.com` is correct the same way `ibm.com` is correct for International
   * Business Machines. A cleanup rule that cannot recognise an acronym will happily
   * "fix" every well-branded company in the portal.
   */
  const initials = name => (name || '').split(/\s+/).filter(Boolean).map(w => w[0].toLowerCase()).join('');
  const derives = c => {
    const d = slug(baseOf(c.properties.domain));
    const n = slug(c.properties.name);
    if (!d) return true;                                   // nothing to judge
    if (n.slice(0, 10) === d.slice(0, 10)) return true;     // spelled out
    if (d === initials(c.properties.name)) return true;     // pure acronym: ibm.com
    if (n.startsWith(d) || d.startsWith(n.slice(0, 6))) return true; // shortened form
    // acronym of leading words plus a real word, e.g. ZIA + od -> ziaod
    if (n.startsWith(d.slice(0, 3)) && d.length <= n.length) return true;
    return false;
  };

  const taken = new Set(companies.map(c => (c.properties.domain || '').toLowerCase()));
  const broken = companies.filter(c => !derives(c));

  console.log(`companies: ${companies.length}   domain not derived from name: ${broken.length}`);
  if (!broken.length) { console.log('nothing to repair'); return; }

  const rename = new Map();            // old domain -> new domain
  const companyUpdates = [];
  for (const c of broken) {
    const old = (c.properties.domain || '').toLowerCase();
    let candidate = `${slug(c.properties.name)}.com`;
    let n = 2;
    while (taken.has(candidate) && n < 50) candidate = `${slug(c.properties.name)}${n++}.com`;
    if (taken.has(candidate)) continue;
    taken.delete(old); taken.add(candidate);
    rename.set(old, candidate);
    companyUpdates.push({ id: c.id, properties: { domain: candidate }, __name: c.properties.name, __old: old });
  }

  // Contacts whose email sits on a renamed domain, restricted to that company's own
  // people so a shared freemail domain can never be swept up.
  const companyById = new Map(companies.map(c => [String(c.id), c]));
  const contactUpdates = [];
  for (const ct of contacts) {
    const email = (ct.properties.email || '').toLowerCase();
    const at = email.indexOf('@');
    if (at < 0) continue;
    const dom = email.slice(at + 1);
    if (!rename.has(dom)) continue;
    // only rewrite if this contact actually belongs to a company on that domain
    const linked = (contactCompany.get(String(ct.id)) || [])
      .some(id => (companyById.get(String(id))?.properties.domain || '').toLowerCase() === dom);
    if (!linked) continue;
    contactUpdates.push({ id: ct.id, properties: { email: `${email.slice(0, at)}@${rename.get(dom)}` } });
  }

  console.log(`\nrepairs: ${companyUpdates.length} domains · ${contactUpdates.length} contact emails\n`);
  for (const u of companyUpdates.slice(0, 10)) {
    console.log(`  ${u.__name.padEnd(30)} ${u.__old.padEnd(30)} ->  ${u.properties.domain}`);
  }
  if (companyUpdates.length > 10) console.log(`  … and ${companyUpdates.length - 10} more`);

  if (!APPLY) { console.log('\ndry run — re-run with --apply.'); return; }

  const rc = await batch('companies', 'update', companyUpdates.map(({ id, properties }) => ({ id, properties })));
  console.log(`\ndomains updated ${rc.ok}  failed ${rc.failed}`);
  if (contactUpdates.length) {
    const rt = await batch('contacts', 'update', contactUpdates);
    console.log(`emails updated  ${rt.ok}  failed ${rt.failed}`);
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
