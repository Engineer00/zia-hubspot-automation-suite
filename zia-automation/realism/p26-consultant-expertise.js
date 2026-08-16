#!/usr/bin/env node
'use strict';
/**
 * P26 — give consultants an expertise model.
 *
 * THE GAP
 * "Specialty experience" is the largest recorded loss reason in the portal — 45 deals,
 * $1,785,558 — and there is **no field for specialty**. Everything the CRM knows about
 * a consultant is a timezone, a price, and a personality label:
 *
 *     tier · coverage band · cost rate · hours · bench status · compliance
 *
 * So the business can say it loses on expertise but cannot say which expertise. For a
 * firm whose whole job is matching the right professional to the right organization,
 * "right" currently means only *available and in the correct timezone*.
 *
 * WHAT THIS ADDS
 *   zia_sector_expertise     multi   which industries they have actually worked in
 *   zia_service_lines        multi   what they can deliver
 *   zia_years_experience     number
 *   zia_seniority            select  Associate -> Partner
 *   zia_certifications       multi   ICF, Hogan, Prosci, MBTI, SHRM
 *   zia_engagements_delivered number  COMPUTED from delivery history
 *   zia_avg_delivered_health  number  COMPUTED — their real track record
 *
 * The last two are the important ones. A CV claim is self-reported; average delivered
 * health is *measured*, and it is already sitting in the data unaggregated. That is a
 * performance record no candidate can inflate.
 *
 * HONESTY
 * Sectors, certifications and tenure are SYNTHESISED — correlated with tier so a
 * Summit consultant reads as senior, but invented. The schema and the matching logic
 * are the deliverable; the credentials are modelled, not real.
 *
 *   node realism/p26-consultant-expertise.js            dry run
 *   node realism/p26-consultant-expertise.js --apply    create + populate
 */
const { api, listAll, batch, readAssociations } = require('../lib/hubspot');

const APPLY = process.argv.includes('--apply');

const SECTORS = ['technology', 'professional_services', 'healthcare', 'manufacturing',
  'logistics', 'financial_services', 'nonprofit', 'retail_consumer', 'education', 'construction'];
const SECTOR_LABEL = {
  technology: 'Technology & SaaS', professional_services: 'Professional Services',
  healthcare: 'Healthcare', manufacturing: 'Manufacturing', logistics: 'Logistics & Supply Chain',
  financial_services: 'Financial Services', nonprofit: 'Nonprofit & Social Impact',
  retail_consumer: 'Retail & Consumer', education: 'Education', construction: 'Construction & Trades',
};
const SERVICE_LINES = ['Leadership Development', 'Executive Coaching', 'Team Effectiveness',
  'Change Management', 'Succession Planning', 'Culture & Engagement',
  'Organizational Design', 'Performance Consulting', 'Training & Coaching'];
const CERTS = ['ICF ACC', 'ICF PCC', 'ICF MCC', 'Hogan Certified', 'MBTI Certified',
  'Prosci Change Practitioner', 'SHRM-SCP', 'Korn Ferry 360'];

// Tier drives seniority, tenure and breadth. A Summit consultant should read senior.
const TIER = {
  core:     { yrs: [3, 9],   sen: ['Associate', 'Consultant'],            sectors: [1, 2], lines: [1, 3], certs: [0, 2] },
  momentum: { yrs: [7, 16],  sen: ['Consultant', 'Senior Consultant'],    sectors: [2, 3], lines: [2, 4], certs: [1, 3] },
  summit:   { yrs: [12, 26], sen: ['Principal', 'Partner'],               sectors: [2, 4], lines: [3, 5], certs: [2, 4] },
};

const seeded = s => {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
};
const between = (rnd, [lo, hi]) => lo + Math.floor(rnd() * (hi - lo + 1));
const sample = (rnd, arr, n) => {
  const pool = [...arr];
  const out = [];
  for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
};

const enumProp = (name, label, values, desc, multi) => ({
  name, label, type: 'enumeration', fieldType: multi ? 'checkbox' : 'select',
  description: desc,
  options: values.map((v, i) => ({ label: v.label || v, value: v.value || v, displayOrder: i, hidden: false })),
});

const PROPS = [
  enumProp('zia_sector_expertise', 'Sector Expertise',
    SECTORS.map(s => ({ value: s, label: SECTOR_LABEL[s] })),
    'Industries this consultant has delivered in. Used to match engagements to real experience.', true),
  enumProp('zia_service_lines', 'Service Lines',
    SERVICE_LINES, 'Which ZIA service lines this consultant can deliver.', true),
  { name: 'zia_years_experience', label: 'Years of Experience', type: 'number', fieldType: 'number',
    description: 'Total years in organizational development / consulting.' },
    // HubSpot ships a built-in 'seniority' property and rejects a duplicate LABEL
  // (not name). 'Consultant Grade' is the better label here anyway — it is the
  // delivery grade that decides who can front a Summit engagement.
  enumProp('zia_seniority', 'Consultant Grade',
    ['Associate', 'Consultant', 'Senior Consultant', 'Principal', 'Partner'],
    'Grade. Determines who can front a Summit engagement.', false),
  enumProp('zia_certifications', 'Certifications', CERTS,
    'Coaching and change credentials a proposal can cite.', true),
  { name: 'zia_engagements_delivered', label: 'Engagements Delivered', type: 'number', fieldType: 'number',
    description: 'Count of delivery engagements this consultant has run. Computed from the CRM.' },
  { name: 'zia_avg_delivered_health', label: 'Avg Delivered Health', type: 'number', fieldType: 'number',
    description: 'Mean health score across their engagements — a measured track record, '
      + 'not a self-reported one. Computed from the CRM.' },
];

(async () => {
  if (APPLY) {
    for (const p of PROPS) {
      try { await api('POST', '/crm/v3/properties/contacts', { ...p, groupName: 'contactinformation' }); console.log(`  created ${p.name}`); }
      catch (e) {
        if (!String(e.message).includes('already exists')) throw e;
        if (p.options) await api('PATCH', `/crm/v3/properties/contacts/${p.name}`, { options: p.options });
      }
    }
  }

  const contacts = await listAll('contacts', ['email', 'firstname', 'lastname', 'zia_contact_type', 'zia_tier']);
  const talent = contacts.filter(c => c.properties.zia_contact_type === 'talent');
  const deals = await listAll('deals', ['zia_deal_type', 'zia_placement_status', 'zia_health_score',
    'zia_talent_email', 'zia_service_type']);
  const placements = deals.filter(d => d.properties.zia_deal_type && d.properties.zia_placement_status);
  const companies = await listAll('companies', ['zia_industry']);
  const coById = new Map(companies.map(c => [String(c.id), c]));
  const dealCompany = await readAssociations('deals', 'companies', placements.map(d => d.id));

  // ---- track record, measured from real delivery -------------------------
  const history = new Map();               // email -> { n, health[], sectors:Set, lines:Set }
  for (const d of placements) {
    const email = d.properties.zia_talent_email;
    if (!email) continue;
    const h = history.get(email) || { n: 0, health: [], sectors: new Set(), lines: new Set() };
    h.n++;
    const score = +d.properties.zia_health_score;
    if (!isNaN(score) && score > 0) h.health.push(score);
    const co = (dealCompany.get(String(d.id)) || [])[0];
    const sector = co && coById.get(String(co))?.properties.zia_industry;
    if (sector) h.sectors.add(sector);
    for (const line of (d.properties.zia_service_type || '').split(';').map(x => x.trim()).filter(Boolean)) h.lines.add(line);
    history.set(email, h);
  }

  const updates = [];
  const senDist = {}, yrsAll = [];
  for (const c of talent) {
    const email = c.properties.email;
    const tier = c.properties.zia_tier || 'momentum';
    const cfg = TIER[tier] || TIER.momentum;
    const rnd = seeded(email);

    const past = history.get(email);
    const years = between(rnd, cfg.yrs);
    const seniority = cfg.sen[Math.floor(rnd() * cfg.sen.length)];

    // Expertise starts from what they have ACTUALLY delivered, then widens to the
    // declared breadth for the tier. Real history first, synthesis only to fill.
    const sectors = new Set(past ? past.sectors : []);
    for (const s of sample(rnd, SECTORS.filter(s => !sectors.has(s)), Math.max(0, between(rnd, cfg.sectors) - sectors.size))) sectors.add(s);
    const lines = new Set(past ? past.lines : []);
    for (const l of sample(rnd, SERVICE_LINES.filter(l => !lines.has(l)), Math.max(0, between(rnd, cfg.lines) - lines.size))) lines.add(l);

    const certs = sample(rnd, CERTS, between(rnd, cfg.certs));
    const delivered = past ? past.n : 0;
    const avgHealth = past && past.health.length
      ? Math.round(past.health.reduce((a, b) => a + b, 0) / past.health.length) : '';

    senDist[seniority] = (senDist[seniority] || 0) + 1;
    yrsAll.push(years);

    updates.push({
      id: c.id,
      properties: {
        zia_sector_expertise: [...sectors].join(';'),
        zia_service_lines: [...lines].join(';'),
        zia_years_experience: String(years),
        zia_seniority: seniority,
        zia_certifications: certs.join(';'),
        zia_engagements_delivered: String(delivered),
        ...(avgHealth === '' ? {} : { zia_avg_delivered_health: String(avgHealth) }),
      },
    });
  }

  const withHistory = updates.filter(u => +u.properties.zia_engagements_delivered > 0).length;
  console.log(`\nconsultants            : ${talent.length}`);
  console.log(`  with delivery history: ${withHistory}  (track record is measured, not claimed)`);
  console.log(`  seniority            : ${JSON.stringify(senDist)}`);
  console.log(`  years experience     : ${Math.min(...yrsAll)}-${Math.max(...yrsAll)}, median ${yrsAll.sort((a, b) => a - b)[Math.floor(yrsAll.length / 2)]}`);
  const sample3 = updates.slice(0, 3);
  console.log('\nsamples:');
  for (const u of sample3) {
    const c = talent.find(t => String(t.id) === String(u.id));
    console.log(`  ${(c.properties.firstname + ' ' + c.properties.lastname).padEnd(22)} ${u.properties.zia_seniority.padEnd(18)} ${u.properties.zia_years_experience}y`);
    console.log(`     sectors  ${u.properties.zia_sector_expertise}`);
    console.log(`     lines    ${u.properties.zia_service_lines}`);
    console.log(`     certs    ${u.properties.zia_certifications || '(none)'}`);
    console.log(`     record   ${u.properties.zia_engagements_delivered} engagements, avg health ${u.properties.zia_avg_delivered_health || 'n/a'}`);
  }

  if (!APPLY) { console.log('\ndry run — re-run with --apply.'); return; }
  const r = await batch('contacts', 'update', updates);
  console.log(`\nupdated ${r.ok}  failed ${r.failed}`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
