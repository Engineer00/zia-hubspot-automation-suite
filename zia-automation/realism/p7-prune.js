'use strict';
/**
 * P7 — prune the empty shells, and work the ones we keep.
 *
 * 676 of 1,671 companies (40%) have no deals, no contacts and no activity. Real
 * CRMs do carry prospect records, but at roughly 10%, not 40% — and a real prospect
 * has been *touched*: a call, an email, a note. An untouched record with today's
 * create date is the tell.
 *
 * So: keep 100 as genuine worked prospects and give them prospecting activity,
 * archive the rest.
 *
 * Also fixes a platform limitation honestly. `createdate` is read-only on companies
 * and contacts (it is writable on deals and tickets — HubSpot is inconsistent here),
 * so those records will always show today. Rather than pretend, we add a dedicated
 * `zia_client_since` date derived from the earliest related deal, and report on that.
 * That is what you would do on a real migration where the system field is immutable.
 */
const { api, listAll, batch, readAssociations, OWNER_ID } = require('../lib/hubspot');
const { rng, pick, weighted, int, iso, businessTime, DAY } = require('./lib');

const KEEP_PROSPECTS = 100;
const A = { calls: 182, emails: 186, notes: 190, tasks: 192 };
const HD = id => [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: id }];

const PROSPECT_NOTE = [
  'Inbound enquiry from the leadership development guide. Routed for qualification.',
  'Met the People lead at a HR conference — growing fast, no formal manager training yet.',
  'Referred by an existing client. Worth a first conversation next quarter.',
  'Responded to the org-design assessment campaign. Not budgeted this cycle.',
];
const PROSPECT_CALL = [
  'Left voicemail for the People lead. Following up by email.',
  'Brief intro call — interested but reviewing budget in the next planning cycle.',
  'Connected with the COO. Headcount growing; revisit after their reorg lands.',
];
const PROSPECT_EMAIL = [
  'Sent the leadership development overview and asked for 20 minutes.',
  'Shared a case study on manager effectiveness at a similar-stage company.',
  'Checked in after their funding announcement.',
];

module.exports = async function p7({ dryRun }) {
  const companies = await listAll('companies', ['name', 'domain', 'createdate']);
  const seeded = companies.filter(c => c.properties.domain !== 'hubspot.com');
  const ids = seeded.map(c => c.id);

  const withDeals = await readAssociations('companies', 'deals', ids);
  const withContacts = await readAssociations('companies', 'contacts', ids);

  const empty = seeded.filter(c => !(withDeals.get(c.id) || []).length && !(withContacts.get(c.id) || []).length);
  console.log(`  companies: ${seeded.length}   empty: ${empty.length}`);

  // deterministic split so re-runs agree
  const sorted = [...empty].sort((a, b) => a.id.localeCompare(b.id));
  const keep = sorted.slice(0, KEEP_PROSPECTS);
  const drop = sorted.slice(KEEP_PROSPECTS);
  console.log(`  keeping as worked prospects: ${keep.length}`);
  console.log(`  archiving: ${drop.length}`);

  /* ---------- 1. archive the shells ---------- */
  let archived = 0;
  if (!dryRun) {
    for (let i = 0; i < drop.length; i += 100) {
      try {
        await api('POST', '/crm/v3/objects/companies/batch/archive', {
          inputs: drop.slice(i, i + 100).map(c => ({ id: c.id })),
        });
        archived += Math.min(100, drop.length - i);
      } catch (e) { console.log(`    ! archive failed: ${e.message.slice(0, 200)}`); }
    }
  }
  console.log(`  archived: ${dryRun ? drop.length + ' (dry)' : archived}`);

  /* ---------- 2. work the prospects we keep ---------- */
  const bucket = { notes: [], calls: [], emails: [], tasks: [] };
  const prospectUpdates = [];

  for (const c of keep) {
    const r = rng('prospect:' + c.id);
    const n = int(r, 1, 3);
    for (let i = 0; i < n; i++) {
      const ts = businessTime(r, Date.now() - int(r, 5, 260) * DAY).getTime();
      const kind = weighted(r, [['emails', 40], ['calls', 32], ['notes', 28]]);
      const assoc = [{ to: { id: c.id }, types: HD(A[kind]) }];

      if (kind === 'calls') {
        bucket.calls.push({ properties: {
          hs_timestamp: iso(ts), hs_call_title: 'Prospecting call', hs_call_body: pick(r, PROSPECT_CALL),
          hs_call_duration: String(int(r, 2, 14) * 60000), hs_call_direction: 'OUTBOUND',
          hs_call_status: weighted(r, [['COMPLETED', 55], ['NO_ANSWER', 30], ['CONNECTING', 15]]),
          hubspot_owner_id: OWNER_ID,
        }, associations: assoc });
      } else if (kind === 'emails') {
        bucket.emails.push({ properties: {
          hs_timestamp: iso(ts), hs_email_subject: 'ZIA — leadership development',
          hs_email_text: pick(r, PROSPECT_EMAIL), hs_email_direction: 'EMAIL',
          hs_email_status: 'SENT', hubspot_owner_id: OWNER_ID,
        }, associations: assoc });
      } else {
        bucket.notes.push({ properties: {
          hs_timestamp: iso(ts), hs_note_body: pick(r, PROSPECT_NOTE), hubspot_owner_id: OWNER_ID,
        }, associations: assoc });
      }
    }

    // an open next step on roughly half of them
    if (r() < 0.5) {
      bucket.tasks.push({ properties: {
        hs_timestamp: iso(businessTime(r, Date.now() + int(r, 2, 30) * DAY).getTime()),
        hs_task_subject: pick(r, ['Follow up on intro email', 'Re-engage after their planning cycle', 'Book discovery call']),
        hs_task_body: 'Open prospect — no engagement sold yet.',
        hs_task_status: 'NOT_STARTED', hs_task_priority: weighted(r, [['MEDIUM', 60], ['LOW', 40]]),
        hubspot_owner_id: OWNER_ID,
      }, associations: [{ to: { id: c.id }, types: HD(A.tasks) }] });
    }

    prospectUpdates.push({ id: c.id, properties: {
      lifecyclestage: 'lead',
      hs_lead_status: weighted(r, [['NEW', 34], ['OPEN', 26], ['ATTEMPTED_TO_CONTACT', 24], ['BAD_TIMING', 16]]),
    }});
  }

  const total = Object.values(bucket).reduce((s, a) => s + a.length, 0);
  console.log(`  prospecting activities to create: ${total}`);
  const created = {};
  for (const [kind, inputs] of Object.entries(bucket)) {
    if (!inputs.length) continue;
    const res = await batch(kind, 'create', inputs, { dryRun });
    created[kind] = res.ok;
  }
  const pRes = await batch('companies', 'update', prospectUpdates, { dryRun });
  console.log(`  prospects staged: ${pRes.ok || pRes.wouldWrite || 0}`);

  /* ---------- 3. zia_client_since (createdate is immutable on companies) ---------- */
  const live = await listAll('companies', ['name', 'domain']);
  const liveSeeded = live.filter(c => c.properties.domain !== 'hubspot.com');
  const liveDeals = await readAssociations('companies', 'deals', liveSeeded.map(c => c.id));

  const allDeals = await listAll('deals', ['createdate', 'zia_deal_type']);
  const dealCreated = new Map(allDeals.map(d => [d.id, d.properties.createdate]));

  const sinceUpdates = [];
  for (const c of liveSeeded) {
    const related = (liveDeals.get(c.id) || []).map(id => dealCreated.get(id)).filter(Boolean);
    if (!related.length) continue;
    const earliest = related.sort()[0];
    sinceUpdates.push({ id: c.id, properties: { zia_client_since: earliest.slice(0, 10) } });
  }
  console.log(`  zia_client_since to set: ${sinceUpdates.length}`);
  const sRes = await batch('companies', 'update', sinceUpdates, { dryRun });

  return {
    archived: dryRun ? undefined : archived,
    prospectsKept: keep.length,
    prospectActivities: total,
    clientSinceSet: sRes.ok,
    failed: pRes.failed + sRes.failed,
  };
};
