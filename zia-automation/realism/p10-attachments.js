'use strict';
/**
 * P10 — record attachments.
 *
 * A CRM with no documents on it is a CRM nobody actually works in. Four document
 * types, each attached where a real operator would look for it:
 *
 *   Statement of Work      -> closed-won acquisition deals
 *   Consultant profile     -> talent contacts who are placed or bench-ready
 *   Compliance certificate -> talent contacts whose compliance is clear
 *   Engagement review      -> at-risk placements (the QBR that should have happened)
 *
 * Mechanics: upload to the File Manager, then create a NOTE carrying
 * `hs_attachment_ids` and associate the note to the record. That is how HubSpot
 * itself models an attachment — a file alone is not visible on a record.
 *
 * Idempotent: every note gets a marker line in its body, and existing marked
 * notes are read first, so re-runs write nothing.
 *
 * Requires private-app scopes: files, files.read, files.ui_hidden.read
 *
 *   node realism/p10-attachments.js --dry-run
 *   node realism/p10-attachments.js --limit 25
 */
const path = require('path');
const { api, listAll, pool, readAssociations } = require('../lib/hubspot');
const { buildPdf } = require('../lib/pdf');
const { rng } = require('./lib');

const FOLDER = 'zia-crm-documents';
const MARKER = '[zia-doc]';                 // idempotency marker, kept in note body
const KEY_FILE = path.join(__dirname, '..', '..', 'hubspot_service_key.txt');
const TOKEN = process.env.HUBSPOT_TOKEN || (require('fs').existsSync(KEY_FILE) ? (require('fs').readFileSync(KEY_FILE, 'utf8').match(/pat-[A-Za-z0-9-]+/)||[])[0] : null);

const NOTE_TO = { deals: 214, contacts: 202, companies: 190 };

const usd = n => '$' + Math.round(n).toLocaleString('en-US');
const day = d => (d || '').slice(0, 10);
const titleCase = s => String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// ---------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------

/**
 * Files uses multipart/form-data, so it cannot go through the JSON api() helper.
 * Retries 429/5xx the same way.
 */
async function uploadFile(buffer, filename) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/pdf' }), filename);
  form.append('folderPath', `/${FOLDER}`);
  form.append('options', JSON.stringify({
    access: 'PRIVATE',                       // CRM attachments must not be public
    overwrite: false,
    duplicateValidationStrategy: 'NONE',
    duplicateValidationScope: 'EXACT_FOLDER',
  }));

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch('https://api.hubapi.com/files/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: form,
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`upload ${filename} -> ${res.status} ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return JSON.parse(text).id;
  }
  throw new Error(`upload ${filename} -> retries exhausted`);
}

/** Upload + attach via a note, associated to one record. */
async function attach({ buffer, filename, object, recordId, noteBody, timestamp }) {
  const fileId = await uploadFile(buffer, filename);
  await api('POST', '/crm/v3/objects/notes', {
    properties: {
      hs_timestamp: timestamp || new Date().toISOString(),
      hs_note_body: `${noteBody}<br><br>${MARKER}`,
      hs_attachment_ids: String(fileId),
    },
    associations: [{
      to: { id: recordId },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO[object] }],
    }],
  });
  return fileId;
}

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------

const TIER_LABEL = { core: 'Core', momentum: 'Momentum', summit: 'Summit' };

function sowPdf(deal, company) {
  const p = deal.properties;
  const tier = TIER_LABEL[p.zia_deal_type] || 'Core';
  const seats = p.zia_seats_committed || 1;
  const hours = p.zia_hours_per_week || 0;

  return buildPdf({
    blocks: [
      { type: 'title', text: 'Statement of Work' },
      { type: 'meta', text: `ZIA Organizational Development  ·  ${tier} Program  ·  SOW-${deal.id.slice(-6)}` },
      { type: 'h', text: 'Parties' },
      { type: 'kv', rows: [
        ['Client', company || 'Client organization'],
        ['Provider', 'ZIA Organizational Development'],
        ['Engagement', p.dealname || ''],
        ['Effective date', day(p.closedate)],
      ]},
      { type: 'h', text: 'Scope of services' },
      { type: 'p', text: `ZIA will deliver its ${tier} program covering ${(p.zia_service_type || 'Leadership Development').split(';').join(', ')}. `
        + `Delivery is scheduled at ${hours} hours per week across ${seats} committed seat(s), beginning on the launch date below `
        + `and continuing until the objectives in the engagement plan are met or either party terminates under the notice provisions.` },
      { type: 'h', text: 'Commercial terms' },
      { type: 'kv', rows: [
        ['Contract value', usd(+p.amount || 0)],
        ['Committed seats', seats],
        ['Hours per week', hours],
        ['Expected launch', day(p.zia_expected_launch_date) || 'On execution'],
        ['Payment terms', titleCase(p.zia_payment_terms || 'net_30')],
      ]},
      { type: 'h', text: 'Governance' },
      { type: 'p', text: 'Engagement health is reviewed on a rolling basis and reported against a target score of 70. '
        + 'Scores below 60 trigger a joint review within ten business days. Either party may terminate on 30 days written notice; '
        + 'fees are payable for services rendered to the termination date.' },
      { type: 'sign', name: 'Salman Akbar', role: 'Engagement Director, ZIA' },
    ],
    footer: `${MARKER} generated for the ZIA CRM demonstration portal - not a real contract`,
  });
}

function profilePdf(contact) {
  const p = contact.properties;
  const name = [p.firstname, p.lastname].filter(Boolean).join(' ') || 'Consultant';
  const tier = TIER_LABEL[p.zia_tier] || 'Core';
  const r = rng('profile' + contact.id);
  const years = 4 + Math.floor(r() * 14);

  return buildPdf({
    blocks: [
      { type: 'title', text: name },
      { type: 'meta', text: `Consultant Profile  ·  ${tier} tier  ·  ZIA delivery network` },
      { type: 'h', text: 'Availability' },
      { type: 'kv', rows: [
        ['Bench status', titleCase(p.zia_bench_status)],
        ['Coverage', p.zia_coverage_band || 'US Eastern'],
        ['Committed hours', `${p.zia_hours_per_week || 0} per week`],
        ['Compliance', titleCase(p.zia_compliance_status)],
        ['Experience', `${years} years`],
      ]},
      { type: 'h', text: 'Areas of focus' },
      { type: 'p', text: `${tier}-tier consultant with ${years} years in organizational development. `
        + `Assessment profile on file: ${titleCase(p.zia_assessment_profile) || 'standard'}. `
        + `Engaged primarily on leadership development, team effectiveness and change programs, `
        + `working embedded with client teams rather than in an advisory-only capacity.` },
      { type: 'h', text: 'Engagement model' },
      { type: 'p', text: 'Available for embedded delivery within the stated coverage band. '
        + 'Placement is subject to current compliance status; lapsed or unstarted certification blocks assignment automatically.' },
    ],
    footer: `${MARKER} generated for the ZIA CRM demonstration portal`,
  });
}

function compliancePdf(contact) {
  const p = contact.properties;
  const name = [p.firstname, p.lastname].filter(Boolean).join(' ') || 'Consultant';
  const r = rng('comp' + contact.id);
  const issued = new Date(Date.now() - Math.floor(r() * 300 + 30) * 864e5);
  const expires = new Date(issued.getTime() + 730 * 864e5);

  return buildPdf({
    blocks: [
      { type: 'title', text: 'Certificate of Compliance' },
      { type: 'meta', text: 'ZIA delivery network  ·  consultant onboarding and background verification' },
      { type: 'space', h: 8 },
      { type: 'p', text: `This certifies that the consultant named below has completed ZIA's onboarding requirements, `
        + `including background verification, confidentiality undertaking, and client-site conduct training, `
        + `and is cleared for embedded placement with client organizations.` },
      { type: 'h', text: 'Consultant' },
      { type: 'kv', rows: [
        ['Name', name],
        ['Tier', TIER_LABEL[p.zia_tier] || 'Core'],
        ['Certificate no.', `ZIA-C-${contact.id.slice(-7)}`],
        ['Issued', issued.toISOString().slice(0, 10)],
        ['Valid until', expires.toISOString().slice(0, 10)],
        ['Status', titleCase(p.zia_compliance_status)],
      ]},
      { type: 'sign', name: 'Salman Akbar', role: 'Delivery Operations, ZIA' },
    ],
    footer: `${MARKER} generated for the ZIA CRM demonstration portal - not a real certificate`,
  });
}

function reviewPdf(deal, company) {
  const p = deal.properties;
  const health = +p.zia_health_score || 0;
  const r = rng('review' + deal.id);
  const causes = [
    'Sponsor changed mid-programme and objectives were not re-baselined.',
    'Participant attendance fell below the threshold agreed at launch.',
    'Scope expanded without a corresponding change to committed hours.',
    'Coverage band mismatch is causing scheduling friction with the client team.',
    'Measurable outcomes were never defined, so progress cannot be evidenced.',
  ];

  return buildPdf({
    blocks: [
      { type: 'title', text: 'Engagement Review' },
      { type: 'meta', text: `${p.dealname || 'Engagement'}  ·  ${company || ''}  ·  at-risk review` },
      { type: 'h', text: 'Position' },
      { type: 'kv', rows: [
        ['Health score', `${health} / 100  (target 70)`],
        ['Status', titleCase(p.zia_placement_status)],
        ['Programme', TIER_LABEL[p.zia_deal_type] || 'Core'],
        ['Weekly hours', p.zia_hours_per_week || 0],
        ['Started', day(p.zia_embed_start_date)],
        ['Contract value', usd(+p.amount || 0)],
      ]},
      { type: 'h', text: 'Assessment' },
      { type: 'p', text: `This engagement is scoring ${health} against a target of 70 and has been flagged for joint review. `
        + causes[Math.floor(r() * causes.length)] },
      { type: 'h', text: 'Actions' },
      { type: 'p', text: '1. Re-baseline objectives with the current sponsor within ten business days.\n'
        + '2. Confirm the delivery pattern against the committed hours in the SOW.\n'
        + '3. Agree two measurable outcomes and a review date.\n'
        + '4. Escalate to the engagement director if the score has not moved by the next review.' },
      { type: 'sign', name: 'Salman Akbar', role: 'Engagement Director, ZIA' },
    ],
    footer: `${MARKER} generated for the ZIA CRM demonstration portal`,
  });
}

// ---------------------------------------------------------------------------

module.exports = async function p10({ dryRun, limit = 50 }) {
  const [deals, contacts, companies] = await Promise.all([
    listAll('deals', ['dealname', 'amount', 'closedate', 'dealstage', 'zia_deal_type',
      'zia_placement_status', 'zia_health_score', 'zia_hours_per_week', 'zia_seats_committed',
      'zia_service_type', 'zia_expected_launch_date', 'zia_embed_start_date', 'zia_payment_terms']),
    listAll('contacts', ['firstname', 'lastname', 'email', 'zia_contact_type', 'zia_tier',
      'zia_bench_status', 'zia_compliance_status', 'zia_coverage_band', 'zia_hours_per_week',
      'zia_assessment_profile']),
    listAll('companies', ['name']),
  ]);

  const companyName = new Map(companies.map(c => [c.id, c.properties.name]));
  const dealCompany = await readAssociations('deals', 'companies', deals.map(d => d.id));
  const nameFor = d => companyName.get((dealCompany.get(String(d.id)) || [])[0]) || '';

  const seeded = deals.filter(d => d.properties.zia_deal_type);
  const talent = contacts.filter(c => c.properties.zia_contact_type === 'talent');

  // ---- already-attached, so re-runs are no-ops ----
  const notes = await listAll('notes', ['hs_note_body', 'hs_attachment_ids']);
  const marked = notes.filter(n => (n.properties.hs_note_body || '').includes(MARKER));
  const covered = new Set();
  for (const kind of ['deals', 'contacts']) {
    const map = await readAssociations('notes', kind, marked.map(n => n.id));
    for (const ids of map.values()) for (const id of ids) covered.add(id);
  }
  console.log(`  existing zia-doc notes: ${marked.length} covering ${covered.size} record(s)`);

  // ---- pick targets ----
  const wonAcq = seeded
    .filter(d => d.properties.dealstage === 'closedwon' && !d.properties.zia_placement_status)
    .sort((a, b) => (b.properties.closedate || '').localeCompare(a.properties.closedate || ''));
  const atRisk = seeded.filter(d => d.properties.zia_placement_status === 'at_risk');
  const placeable = talent.filter(c => ['placed', 'bench_ready'].includes(c.properties.zia_bench_status));
  const compliant = talent.filter(c => c.properties.zia_compliance_status === 'clear');

  /**
   * Pick the target set FIRST, then subtract what is already done.
   *
   * The reverse order — filter then slice — is not idempotent: every run takes the
   * next N uncovered records and walks further down the list forever. Slicing first
   * pins the set, so a second run finds all N covered and writes nothing.
   */
  const take = (rows, n) => rows.slice(0, n).filter(r => !covered.has(String(r.id)));

  const jobs = [
    ...take(wonAcq, limit).map(d => ({
      object: 'deals', record: d, kind: 'SOW',
      filename: `SOW-${(nameFor(d) || 'client').replace(/[^A-Za-z0-9]+/g, '-')}-${d.id.slice(-6)}.pdf`,
      build: () => sowPdf(d, nameFor(d)),
      note: `<b>Statement of Work</b> - executed ${day(d.properties.closedate)}. Contract value ${usd(+d.properties.amount || 0)}.`,
      timestamp: d.properties.closedate,
    })),
    ...take(atRisk, Math.ceil(limit / 2)).map(d => ({
      object: 'deals', record: d, kind: 'Review',
      filename: `Engagement-Review-${d.id.slice(-6)}.pdf`,
      build: () => reviewPdf(d, nameFor(d)),
      note: `<b>Engagement review</b> - health ${d.properties.zia_health_score} against a target of 70. Joint review actions agreed.`,
    })),
    ...take(placeable, limit).map(c => ({
      object: 'contacts', record: c, kind: 'Profile',
      filename: `Profile-${[c.properties.firstname, c.properties.lastname].filter(Boolean).join('-') || c.id}.pdf`,
      build: () => profilePdf(c),
      note: `<b>Consultant profile</b> - current availability, coverage and areas of focus.`,
    })),
    ...take(compliant, Math.ceil(limit / 2)).map(c => ({
      object: 'contacts', record: c, kind: 'Compliance',
      filename: `Compliance-${[c.properties.firstname, c.properties.lastname].filter(Boolean).join('-') || c.id}.pdf`,
      build: () => compliancePdf(c),
      note: `<b>Certificate of compliance</b> - cleared for embedded placement.`,
    })),
  ];

  const byKind = jobs.reduce((a, j) => (a[j.kind] = (a[j.kind] || 0) + 1, a), {});
  console.log(`  to attach: ${JSON.stringify(byKind)}`);

  if (dryRun) return { ok: true, wouldWrite: jobs.length, byKind, alreadyCovered: covered.size };

  let ok = 0, failed = 0;
  await pool(jobs, 3, async job => {
    try {
      await attach({
        buffer: job.build(),
        filename: job.filename,
        object: job.object,
        recordId: job.record.id,
        noteBody: job.note,
        timestamp: job.timestamp,
      });
      ok++;
    } catch (e) {
      failed++;
      if (failed <= 3) console.error(`    ! ${job.filename}: ${String(e.message).slice(0, 200)}`);
    }
  });

  return { ok: true, attached: ok, failed, byKind };
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const limitArg = args.indexOf('--limit');
  module.exports({
    dryRun: args.includes('--dry-run'),
    limit: limitArg > -1 ? +args[limitArg + 1] : 50,
  }).then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error(e); process.exit(1); });
}
