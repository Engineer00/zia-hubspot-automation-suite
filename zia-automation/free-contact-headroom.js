#!/usr/bin/env node
'use strict';
/**
 * Free headroom under the contact ceiling.
 *
 * WHY THIS EXISTS
 * The portal holds 1,002 contacts against a hard free-tier limit of 1,000. Creating
 * another returns:
 *
 *   402  Portal 247000083 cannot create another CONTACT.
 *        It has exceeded the limit of 1000
 *
 * The consequence is worse than a blocked API call. A website form submission still
 * returns 200 and still shows the visitor a thank-you message — but the contact is
 * never created. The lead is silently discarded with no error raised to anyone. A
 * capacity ceiling had become a silent data-loss bug.
 *
 * WHAT IT REMOVES (least load-bearing records in the portal, in this order)
 *   1. HubSpot's own sample contacts — demo data, not ours, referenced by nothing.
 *   2. Client contacts still at lead status NEW with no associated deal, taken
 *      least-recently-active first. These are the thin prospect pool; removing a
 *      handful changes no revenue, pipeline or delivery figure.
 *
 * Never touches consultants (placement deals reference them by email) or any contact
 * with a deal association.
 *
 * HubSpot keeps deleted records restorable for 90 days.
 *
 *   node free-contact-headroom.js                 dry run — lists, writes nothing
 *   node free-contact-headroom.js --apply         perform the removal
 *   node free-contact-headroom.js --target 997    choose the ceiling to land under
 */
const { api, listAll, readAssociations } = require('../zia-automation/lib/hubspot');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const tIdx = args.indexOf('--target');
const TARGET = tIdx > -1 ? +args[tIdx + 1] : 997;

(async () => {
  // `notes_last_activity_date` does not exist on the contact schema — HubSpot returned
  // nothing for it, so the "most dormant first" sort below silently degraded to whatever
  // order the API happened to page in. The filters still protected the data; the
  // PRIORITISATION was the part that was broken, which is worse in a deletion script
  // because it decides WHICH records go. createdate is the reliable fallback here:
  // client contacts carry no activity rollup at all (see rules/09-lead-scoring.js).
  const contacts = await listAll('contacts', [
    'email', 'firstname', 'lastname', 'zia_contact_type',
    'hs_lead_status', 'notes_last_contacted', 'createdate',
  ]);
  console.log(`contacts in portal: ${contacts.length}   target: ${TARGET}`);

  const surplus = contacts.length - TARGET;
  if (surplus <= 0) {
    console.log('already at or under target — nothing to do');
    return;
  }

  // ---- tier 1: HubSpot's sample records ----
  const samples = contacts.filter(c => !c.properties.zia_contact_type);

  // ---- tier 2: unconverted prospects with no deal ----
  const prospects = contacts.filter(c =>
    c.properties.zia_contact_type === 'client_contact' &&
    c.properties.hs_lead_status === 'NEW');

  const dealLinks = await readAssociations('contacts', 'deals', prospects.map(c => c.id));
  const noDeal = prospects
    .filter(c => !(dealLinks.get(String(c.id)) || []).length)
    .sort((a, b) => {
      const key = c => c.properties.notes_last_contacted || c.properties.createdate || '';
      return String(key(a)).localeCompare(String(key(b)));
    });

  // ---- tier 3: prospects whose every deal is already Closed Lost ----
  // Removing these costs no open pipeline and no won revenue. Deals themselves are
  // untouched — only the contact and its association go.
  const withDeals = prospects.filter(c => (dealLinks.get(String(c.id)) || []).length);
  const allDealIds = [...new Set(withDeals.flatMap(c => dealLinks.get(String(c.id))))];
  const dealStage = new Map();
  for (let i = 0; i < allDealIds.length; i += 100) {
    const r = await api('POST', '/crm/v3/objects/deals/batch/read', {
      properties: ['dealstage', 'amount'],
      inputs: allDealIds.slice(i, i + 100).map(id => ({ id })),
    });
    for (const d of r.results) dealStage.set(d.id, d.properties.dealstage);
  }

  const deadOnly = withDeals
    .filter(c => (dealLinks.get(String(c.id)) || [])
      .every(id => dealStage.get(id) === 'closedlost'))
    .sort((a, b) => {
      const key = c => c.properties.notes_last_contacted || c.properties.createdate || '';
      return String(key(a)).localeCompare(String(key(b)));
    });

  console.log(`  sample records: ${samples.length}`);
  console.log(`  prospects at NEW with no deal: ${noDeal.length}`);
  console.log(`  prospects whose deals are all Closed Lost: ${deadOnly.length}`);

  const chosen = [...samples, ...noDeal, ...deadOnly].slice(0, surplus);

  console.log(`\nselected ${chosen.length} record(s):\n`);
  for (const c of chosen) {
    const p = c.properties;
    const links = dealLinks.get(String(c.id)) || [];
    const kind = !p.zia_contact_type ? 'HubSpot sample'
      : links.length ? `prospect · ${links.length} lost deal(s)` : 'prospect · no deal';
    const name = [p.firstname, p.lastname].filter(Boolean).join(' ');
    console.log(`  ${c.id}  ${(p.email || '').padEnd(42)} ${name.padEnd(28)} ${kind}`
      + `  last activity ${(p.notes_last_activity_date || 'never').slice(0, 10)}`);
  }

  if (!APPLY) {
    console.log(`\ndry run — nothing removed. Re-run with --apply to perform it.`);
    return;
  }

  let ok = 0, failed = 0;
  for (const c of chosen) {
    try {
      await api('DELETE', `/crm/v3/objects/contacts/${c.id}`);
      ok++;
    } catch (e) {
      failed++;
      console.error(`  ! ${c.id}: ${String(e.message).slice(0, 160)}`);
    }
  }

  const after = await listAll('contacts', ['email']);
  console.log(`\nremoved ${ok}, failed ${failed}`);
  console.log(`contacts now: ${after.length}   headroom: ${1000 - after.length}`);
})();
