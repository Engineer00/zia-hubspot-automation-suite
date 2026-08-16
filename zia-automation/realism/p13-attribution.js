'use strict';
/**
 * P13 — attribution, built without Marketing Hub.
 *
 * The JD names "marketing attribution" explicitly. HubSpot's own attribution
 * reporting requires Marketing Hub Professional, which this portal does not have,
 * and the marketing APIs are scope-blocked besides.
 *
 * But attribution is not really a HubSpot feature — it is a data model. It needs
 * three things: a source captured at first touch, that source carried onto the
 * revenue object, and a report that groups revenue by it. All three are buildable
 * on a free portal.
 *
 * What this does:
 *   1. Upgrades contacts.zia_source from free text to a governed dropdown. It was
 *      created as text, which is exactly the mistake this build argues against —
 *      an ungoverned source field produces an unreportable attribution model.
 *   2. Backfills first-touch source across all contacts, weighted the way a
 *      consulting firm's mix actually looks (referral-heavy, not ad-heavy).
 *   3. Creates zia_first_touch_source on deals and rolls the source up from the
 *      associated contact, so revenue can be grouped by origin.
 *
 * Deterministic per record id, so re-runs are stable. Idempotent: anything already
 * carrying a value is left alone.
 *
 *   node realism/p13-attribution.js --dry-run
 *   node realism/p13-attribution.js
 */
const { api, listAll, batch, readAssociations } = require('../lib/hubspot');
const { rng } = require('./lib');

/**
 * Source mix for a B2B organizational-development consultancy. Referral and
 * existing-client expansion dominate; paid barely registers. Weighted so the
 * resulting attribution report tells a realistic story rather than a uniform one.
 */
const SOURCES = [
  ['referral',            'Referral',                  0.26],
  ['existing_client',     'Existing client expansion', 0.19],
  ['outbound',            'Outbound',                  0.16],
  ['website_organic',     'Website — organic',         0.14],
  ['inbound_enquiry',     'Inbound enquiry',           0.10],
  ['event_conference',    'Event / conference',        0.08],
  ['partner',             'Partner',                   0.04],
  ['linkedin',            'LinkedIn',                  0.02],
  ['paid_search',         'Paid search',               0.01],
];

/**
 * The seed data already carried source values, in four spellings that predate this
 * dropdown: referral (457), organic (399), inbound (84), conference (60).
 *
 * Converting the property to an enumeration without covering these would leave a
 * thousand contacts holding values invalid against their own property definition —
 * which is exactly the failure mode this build argues against. Map them instead.
 */
const LEGACY = {
  organic: 'website_organic',
  inbound: 'inbound_enquiry',
  conference: 'event_conference',
};

/** Weighted pick from a deterministic 0..1 draw. */
function pickSource(r) {
  let x = r();
  for (const [value, , weight] of SOURCES) {
    if ((x -= weight) <= 0) return value;
  }
  return SOURCES[0][0];
}

const OPTIONS = SOURCES.map(([value, label], i) => ({ label, value, displayOrder: i, hidden: false }));

module.exports = async function p13({ dryRun }) {
  // ---- 1. governed dropdown, not free text ----
  if (!dryRun) {
    await api('PATCH', '/crm/v3/properties/contacts/zia_source', {
      type: 'enumeration', fieldType: 'select', options: OPTIONS,
      label: 'First Touch Source',
      description: 'How this contact first reached ZIA. Governed dropdown so attribution is reportable.',
    });
    console.log('  contacts.zia_source -> enumeration with 8 options');

    try {
      await api('POST', '/crm/v3/properties/deals', {
        name: 'zia_first_touch_source', label: 'First Touch Source',
        groupName: 'dealinformation', type: 'enumeration', fieldType: 'select',
        description: 'Source of the contact that originated this deal. Rolled up by P13.',
        options: OPTIONS,
      });
      console.log('  created deals.zia_first_touch_source');
    } catch (e) {
      if (!String(e.message).includes('already exists')) throw e;
      // Create-if-missing is not enough: if the property already exists it may
      // carry an older option list, and writes of newer values fail validation.
      // Always reconcile the options — same principle as the rules themselves.
      await api('PATCH', '/crm/v3/properties/deals/zia_first_touch_source', { options: OPTIONS });
      console.log('  deals.zia_first_touch_source existed — options reconciled');
    }
  }

  // ---- 2. backfill contacts ----
  const contacts = await listAll('contacts', ['email', 'zia_source', 'zia_contact_type', 'createdate']);
  const valid = new Set(SOURCES.map(([v]) => v));

  const contactUpdates = [];
  let backfilled = 0, normalized = 0;
  for (const c of contacts) {
    const cur = c.properties.zia_source;
    let next = null;
    if (!cur) { next = pickSource(rng('src' + c.id)); backfilled++; }
    else if (LEGACY[cur]) { next = LEGACY[cur]; normalized++; }
    else if (!valid.has(cur)) { next = pickSource(rng('src' + c.id)); normalized++; }
    if (next) contactUpdates.push({ id: c.id, properties: { zia_source: next } });
  }
  console.log(`  contacts: ${contacts.length}  backfilled: ${backfilled}  normalized from legacy: ${normalized}`);

  // ---- 3. roll first touch onto deals ----
  const deals = await listAll('deals', ['dealname', 'zia_deal_type', 'zia_first_touch_source']);
  const seeded = deals.filter(d => d.properties.zia_deal_type);
  const needRollup = seeded.filter(d => !d.properties.zia_first_touch_source);

  const dealContacts = await readAssociations('deals', 'contacts', needRollup.map(d => d.id));

  // source per contact, including the ones we are about to write
  const sourceOf = new Map(contacts.map(c => [String(c.id), c.properties.zia_source]));
  for (const u of contactUpdates) sourceOf.set(String(u.id), u.properties.zia_source);

  const dealUpdates = [];
  let unattributed = 0;
  for (const d of needRollup) {
    const linked = dealContacts.get(String(d.id)) || [];
    // first-touch = the source of the earliest-associated contact we can see;
    // where a deal has no contact link, fall back to a deterministic draw so the
    // report has no silent hole — flagged in the return value so the gap is visible
    const src = linked.map(id => sourceOf.get(String(id))).find(Boolean);
    if (!src) unattributed++;
    dealUpdates.push({
      id: d.id,
      properties: { zia_first_touch_source: src || pickSource(rng('dsrc' + d.id)) },
    });
  }

  console.log(`  deals: ${seeded.length}, needing rollup: ${dealUpdates.length}`
    + `  (${unattributed} had no contact link, sourced deterministically)`);

  if (dryRun) {
    return {
      ok: true, dryRun: true,
      wouldWrite: { contacts: contactUpdates.length, deals: dealUpdates.length },
      unattributedDeals: unattributed,
    };
  }

  const c = await batch('contacts', 'update', contactUpdates);
  const d = await batch('deals', 'update', dealUpdates);
  return { ok: true, contacts: c.ok, deals: d.ok, failed: c.failed + d.failed, unattributedDeals: unattributed };
};

if (require.main === module) {
  module.exports({ dryRun: process.argv.includes('--dry-run') })
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error(e); process.exit(1); });
}
