#!/usr/bin/env node
'use strict';
/**
 * The front door — lead capture into the CRM.
 *
 * Every record in this portal arrived by CSV import. That is the one thing that
 * makes it read as a demo rather than a business: there was no way IN. A real CRM
 * has a path from a stranger on a website to a routed, owned, staged record.
 *
 * The business is two-sided, so the front door is too:
 *
 *   Demand — an organization asking for a programme  -> client_contact
 *   Supply — a consultant joining the network        -> talent
 *
 * Both write the discriminator property on submission, which is what stops the two
 * populations mixing. WF-01 then routes whatever arrives.
 *
 * Idempotent: forms are matched by name and skipped if present.
 *
 *   node forms.js --dry-run
 *   node forms.js
 */
const fs = require('fs');
const path = require('path');
const { api } = require('./lib/hubspot');

const DRY = process.argv.includes('--dry-run');

/** One form field. objectTypeId 0-1 = contact. */
const field = (name, label, fieldType, opts = {}) => ({
  objectTypeId: '0-1',
  name,
  label,
  required: !!opts.required,
  hidden: !!opts.hidden,
  fieldType,
  defaultValue: opts.defaultValue || '',
  placeholder: opts.placeholder || '',
  description: opts.description || '',
  ...(fieldType === 'email' ? { validation: { blockedEmailDomains: [], useDefaultBlockList: false } } : {}),
  ...(opts.options ? { options: opts.options.map(([value, label]) => ({ label, value, displayOrder: 0 })) } : {}),
});

const opt = pairs => pairs;

const FORMS = [
  {
    name: 'ZIA · Request a consultation',
    purpose: 'Demand side. A client organization asking for a programme.',
    fields: [
      field('firstname', 'First name', 'single_line_text', { required: true }),
      field('lastname', 'Last name', 'single_line_text', { required: true }),
      field('email', 'Work email', 'email', { required: true, placeholder: 'you@company.com' }),
      field('company', 'Organization', 'single_line_text', { required: true }),
      field('zia_role', 'Your role', 'dropdown', {
        required: true,
        options: opt([
          ['hr_manager', 'HR Manager'],
          ['ld_manager', 'L&D Manager'],
          ['talent_director', 'Talent Director'],
          ['chro_people_leader', 'CHRO / People Leader'],
          ['department_head', 'Department Head'],
          ['coo_operations', 'COO / Operations'],
          ['ceo_founder', 'CEO / Founder'],
        ]),
      }),
      // NOT zia_service_type — that lives on the deal. What a person enquired about
      // belongs on the person; the deal gets its service type when the deal is created.
      field('zia_interest', 'What do you need help with?', 'dropdown', {
        required: true,
        options: opt([
          ['Leadership Development', 'Leadership Development'],
          ['Executive Coaching', 'Executive Coaching'],
          ['Team Effectiveness', 'Team Effectiveness'],
          ['Change Management', 'Change Management'],
          ['Succession Planning', 'Succession Planning'],
          ['Culture & Engagement', 'Culture & Engagement'],
          ['Organizational Design', 'Organizational Design'],
          ['Performance Consulting', 'Performance Consulting'],
        ]),
      }),
      // the discriminator — hidden, set on every submission
      field('zia_contact_type', 'Contact type', 'single_line_text', {
        hidden: true, defaultValue: 'client_contact',
      }),
      field('zia_source', 'Source', 'single_line_text', {
        hidden: true, defaultValue: 'website_consultation_form',
      }),
    ],
    thankYou: 'Thank you — a member of the ZIA team will be in touch within one business day.',
  },
  {
    name: 'ZIA · Join the consultant network',
    purpose: 'Supply side. A consultant applying to deliver programmes.',
    fields: [
      field('firstname', 'First name', 'single_line_text', { required: true }),
      field('lastname', 'Last name', 'single_line_text', { required: true }),
      field('email', 'Email', 'email', { required: true }),
      field('zia_coverage_band', 'Which hours can you cover?', 'dropdown', {
        required: true,
        options: opt([
          ['US Eastern', 'US Eastern'],
          ['US Central / Mountain', 'US Central / Mountain'],
          ['US Pacific', 'US Pacific'],
          ['Overnight / Overflow', 'Overnight / Overflow'],
        ]),
      }),
      field('zia_hours_per_week', 'Hours available per week', 'number', { required: true }),
      field('zia_contact_type', 'Contact type', 'single_line_text', {
        hidden: true, defaultValue: 'talent',
      }),
      // every applicant starts unverified — WF-06 holds them off the bench until cleared
      field('zia_compliance_status', 'Compliance status', 'single_line_text', {
        hidden: true, defaultValue: 'not_started',
      }),
      field('zia_bench_status', 'Bench status', 'single_line_text', {
        hidden: true, defaultValue: 'in_assessment',
      }),
      field('zia_source', 'Source', 'single_line_text', {
        hidden: true, defaultValue: 'website_consultant_form',
      }),
    ],
    thankYou: 'Thank you — we review applications weekly and will be in touch about next steps.',
  },
];

const chunk = (arr, n) => arr.reduce((a, x, i) => (i % n ? a[a.length - 1].push(x) : a.push([x]), a), []);

const payload = f => ({
  formType: 'hubspot',
  name: f.name,
  archived: false,
  // the v3 create endpoint validates these as required even though it sets them itself
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  // HubSpot caps a field group at 3 fields — a group is a visual row, not a schema
  fieldGroups: chunk(f.fields, 3).map(fields => ({
    groupType: 'default_group', richTextType: 'text', fields,
  })),
  configuration: {
    language: 'en',
    cloneable: true,
    editable: true,
    archivable: true,
    recaptchaEnabled: true,              // a public form without it collects bots
    notifyContactOwner: false,
    notifyRecipients: [],
    createNewContactForNewEmail: false,  // dedupe on email — never create a second contact
    prePopulateKnownValues: true,
    allowLinkToResetKnownValues: false,
    postSubmitAction: { type: 'thank_you', value: f.thankYou },
    lifecycleStages: [],
  },
  displayOptions: {
    renderRawHtml: false,
    theme: 'default_style',
    submitButtonText: 'Submit',
    cssClass: '',
    style: {},
  },
  legalConsentOptions: { type: 'none' },
});

(async () => {
  const existing = new Map();
  let after;
  do {
    const qs = new URLSearchParams({ limit: '50' });
    if (after) qs.set('after', after);
    const r = await api('GET', `/marketing/v3/forms?${qs}`);
    for (const f of r.results || []) existing.set(f.name, f.id);
    after = r.paging && r.paging.next ? r.paging.next.after : null;
  } while (after);
  console.log(`existing forms: ${existing.size}\n`);

  const built = [];
  for (const f of FORMS) {
    if (existing.has(f.name)) {
      console.log(`  skip    ${f.name}  (exists, ${existing.get(f.name)})`);
      built.push({ name: f.name, id: existing.get(f.name), status: 'exists' });
      continue;
    }
    if (DRY) {
      console.log(`  would   ${f.name}  (${f.fields.length} fields)`);
      built.push({ name: f.name, status: 'would-create' });
      continue;
    }
    try {
      const r = await api('POST', '/marketing/v3/forms', payload(f));
      console.log(`  created ${f.name}  id ${r.id}  (${f.fields.length} fields)`);
      built.push({ name: f.name, id: r.id, status: 'created' });
    } catch (e) {
      console.log(`  FAILED  ${f.name} -> ${e.status} ${String(e.message).slice(0, 260).replace(/\n/g, ' ')}`);
      built.push({ name: f.name, status: 'failed' });
    }
  }

  // Write a real, working landing page. Artifacts cannot post to HubSpot (the
  // sandbox blocks external requests), so this is a local file to open directly.
  const live = built.filter(b => b.id);
  if (live.length && !DRY) {
    const portal = '247000083';
    const html = `<!doctype html>
<meta charset="utf-8">
<title>ZIA — live HubSpot forms</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 body{font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#EDF1F2;
      color:#0E2429;margin:0;padding:48px 20px}
 .w{max-width:760px;margin:0 auto}
 h1{font-size:32px;letter-spacing:-.02em;margin:0 0 8px}
 p.sub{color:#40595F;margin:0 0 36px}
 .card{background:#fff;border:1px solid #DBE3E5;border-radius:10px;padding:26px;margin-bottom:22px;
       box-shadow:0 1px 2px rgba(14,36,41,.05),0 4px 16px rgba(14,36,41,.05)}
 h2{font-size:19px;margin:0 0 4px}
 .why{color:#6C858B;font-size:14px;margin:0 0 18px}
 .note{background:#E2F2F0;border:1px solid #9FD5CF;border-radius:8px;padding:14px 16px;font-size:14.5px}
 code{font-family:ui-monospace,Consolas,monospace;font-size:.86em;background:#EAF0F1;
      border:1px solid #DBE3E5;border-radius:3px;padding:1px 5px}
</style>
<div class="w">
<h1>ZIA — the front door</h1>
<p class="sub">Both forms post to HubSpot portal ${portal}. Submissions create real contacts.</p>
${live.map((b, i) => `<div class="card">
  <h2>${FORMS[i] ? FORMS[i].name.replace('ZIA · ', '') : b.name}</h2>
  <p class="why">${FORMS[i] ? FORMS[i].purpose : ''}</p>
  <div class="hs-form-frame" data-region="na2" data-form-id="${b.id}" data-portal-id="${portal}"></div>
</div>`).join('\n')}
<div class="note">
  <b>Open this file directly in a browser</b> — not through a sandboxed preview.
  The embed script loads from HubSpot's CDN, and a strict content policy will block it.
  Submissions land as contacts with <code>zia_contact_type</code> already set, which is what
  keeps client buyers and consultants from mixing.
</div>
</div>
<script src="https://js-na2.hsforms.net/forms/embed/${portal}.js" defer></script>
`;
    const out = path.join(__dirname, 'front-door.html');
    fs.writeFileSync(out, html);
    console.log(`\nwrote ${out}`);
  }

  console.log(`\n${JSON.stringify(built.reduce((a, b) => (a[b.status] = (a[b.status] || 0) + 1, a), {}))}`);
})();
