'use strict';
/**
 * P0 — re-skin to ZIA's actual business.
 *
 * The seed data modelled offshore clinical-admin staffing for dental practices.
 * ZIA is an organizational development and talent solutions company: leadership,
 * psychology, organizational design, operational excellence.
 *
 * The STRUCTURE is already right — a two-sided business, clients on one side and
 * deliverers on the other. Only the vocabulary is wrong. This phase rewrites:
 *
 *   companies  -> growing client organizations across ten sectors
 *   contacts   -> People/HR/Exec buyers, and consultants who deliver
 *   deals      -> engagements sold, and consultants assigned to deliver them
 *   tickets    -> subjects follow the renamed engagements
 *   products   -> ZIA programs rather than dental seats
 */
const { api, listAll, batch, readAssociations } = require('../lib/hubspot');
const { rng, pick, weighted, int } = require('./lib');

/* ---------- sector model ---------- */
const SECTORS = [
  { v: 'technology',           label: 'Technology & SaaS',        std: 'COMPUTER_SOFTWARE',        w: 18, suf: ['Systems','Labs','Technologies','Digital','Software'] },
  { v: 'professional_services',label: 'Professional Services',    std: 'MANAGEMENT_CONSULTING',    w: 16, suf: ['Partners','Advisory','Consulting','Group'] },
  { v: 'healthcare',           label: 'Healthcare',               std: 'HOSPITAL_HEALTH_CARE',     w: 12, suf: ['Health','Care Group','Medical Group'] },
  { v: 'manufacturing',        label: 'Manufacturing',            std: 'MECHANICAL_OR_INDUSTRIAL_ENGINEERING', w: 11, suf: ['Manufacturing','Industries','Works'] },
  { v: 'financial_services',   label: 'Financial Services',       std: 'FINANCIAL_SERVICES',       w: 10, suf: ['Capital','Financial','Wealth Partners'] },
  { v: 'retail_consumer',      label: 'Retail & Consumer',        std: 'RETAIL',                   w: 9,  suf: ['Brands','Retail Group','Goods'] },
  { v: 'logistics',            label: 'Logistics & Supply Chain', std: 'LOGISTICS_AND_SUPPLY_CHAIN', w: 8, suf: ['Logistics','Freight','Supply Co'] },
  { v: 'nonprofit',            label: 'Nonprofit & Social Impact',std: 'NON_PROFIT_ORGANIZATION_MANAGEMENT', w: 7, suf: ['Foundation','Initiative','Alliance'] },
  { v: 'education',            label: 'Education',                std: 'EDUCATION_MANAGEMENT',     w: 5,  suf: ['Academy','Learning','Education Group'] },
  { v: 'construction',         label: 'Construction & Trades',    std: 'CONSTRUCTION',             w: 4,  suf: ['Construction','Builders','Contracting'] },
];

const STEMS = ['Northwind','Beacon','Cardinal','Meridian','Kestrel','Lattice','Ridgeline','Copperfield','Alder','Vantage',
  'Trellis','Hallmark','Wayfinder','Bright Harbor','Ironwood','Larkspur','Quarry','Sable','Thornbury','Verdant',
  'Wexford','Yarrow','Ashgrove','Blackstone','Cobalt','Dunmore','Elmridge','Fairhaven','Glenmoor','Harrowgate',
  'Inglewood','Juniper','Kingsford','Lyndhurst','Marlowe','Norbury','Oakfield','Pemberton','Quill','Rothwell',
  'Stonebridge','Tanglewood','Underhill','Vale','Whitlock','Aldridge','Brookline','Carrow','Draycott','Everton',
  'Foxglove','Granton','Hartley','Ivywell','Jarrow','Keswick','Linden','Merrow','Newbold','Orchard',
  'Pinehill','Redwyn','Sorrel','Tilbury','Upton','Vestry','Winsley','Aster','Bramble','Chesney'];

/* ---------- ZIA service lines ---------- */
const SERVICES = [
  'Leadership Development','Organizational Design','Training & Coaching','Change Management',
  'Performance Consulting','Executive Coaching','Team Effectiveness','Culture & Engagement','Succession Planning',
];

const PROGRAM = { core: 'Core program', momentum: 'Momentum program', summit: 'Summit program' };

/* ---------- roles ---------- */
const ROLES = [
  ['chro_people_leader','CHRO / People Leader',10],
  ['hr_manager','HR Manager',22],
  ['ld_manager','L&D Manager',16],
  ['coo_operations','COO / Operations Lead',14],
  ['ceo_founder','CEO / Founder',13],
  ['talent_director','Talent Director',12],
  ['department_head','Department Head',13],
];

const PROFILES = [
  'Structured / process-driven','Relational / client-facing','Adaptive / cross-functional','Autonomous / ownership-oriented',
];

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,'');

module.exports = async function p0({ dryRun }) {
  /* ---------- 1. rewrite the enum properties ---------- */
  console.log('  updating property options...');
  if (!dryRun) {
    await api('PATCH', '/crm/v3/properties/companies/zia_industry', {
      label: 'Client Sector',
      options: SECTORS.map((s, i) => ({ label: s.label, value: s.v, displayOrder: i, hidden: false })),
    });
    await api('PATCH', '/crm/v3/properties/contacts/zia_role', {
      label: 'Buyer Role',
      options: ROLES.map(([v, l], i) => ({ label: l, value: v, displayOrder: i, hidden: false })),
    });
  }

  /* ---------- 2. companies ---------- */
  const companies = await listAll('companies', ['name','domain','city','state','zia_industry','zia_client_health']);
  const seeded = companies.filter(c => c.properties.domain !== 'hubspot.com');
  console.log(`  companies: ${seeded.length}`);

  const usedName = new Set(), usedDomain = new Set();
  const rename = new Map();   // companyId -> { name, domain, sector }
  const coUpdates = [];

  for (const c of seeded) {
    const r = rng('skin:' + c.id);
    const sector = weighted(r, SECTORS.map(s => [s, s.w]));

    let name, n = 0;
    do {
      const stem = pick(r, STEMS);
      const suf = pick(r, sector.suf);
      name = `${stem} ${suf}`;
      if (n++ > 3) name = `${stem} ${suf} ${int(r, 2, 99)}`;
    } while (usedName.has(name));
    usedName.add(name);

    let domain = slug(name) + '.com', d = 1;
    while (usedDomain.has(domain)) domain = slug(name) + (++d) + '.com';
    usedDomain.add(domain);

    rename.set(c.id, { name, domain, sector: sector.v });
    coUpdates.push({ id: c.id, properties: {
      name, domain, website: `https://${domain}`,
      zia_industry: sector.v, industry: sector.std,
    }});
  }
  const coRes = await batch('companies', 'update', coUpdates, { dryRun });
  console.log(`  companies rewritten: ${coRes.ok || coRes.wouldWrite || 0}`);

  /* ---------- 3. contacts ---------- */
  const contacts = await listAll('contacts', ['email','firstname','lastname','zia_contact_type','zia_role','zia_assessment_profile']);
  const seededCt = contacts.filter(c => c.properties.zia_contact_type);
  const ctCompany = await readAssociations('contacts', 'companies', seededCt.map(c => c.id));

  const ctUpdates = [];
  const takenEmail = new Set();
  for (const c of seededCt) {
    const r = rng('skin:' + c.id);
    const props = {};

    if (c.properties.zia_contact_type === 'client_contact') {
      const co = (ctCompany.get(c.id) || [])[0];
      const info = co && rename.get(co);
      if (info) {
        const f = slug(c.properties.firstname || 'a'), l = slug(c.properties.lastname || 'b');
        let email = `${f}.${l}@${info.domain}`, n = 1;
        while (takenEmail.has(email)) email = `${f}.${l}${++n}@${info.domain}`;
        takenEmail.add(email);
        props.email = email;
      }
      props.zia_role = weighted(r, ROLES.map(([v,,w]) => [v, w]));
    } else {
      props.zia_assessment_profile = pick(r, PROFILES);
    }
    if (Object.keys(props).length) ctUpdates.push({ id: c.id, properties: props });
  }
  const ctRes = await batch('contacts', 'update', ctUpdates, { dryRun });
  console.log(`  contacts rewritten: ${ctRes.ok || ctRes.wouldWrite || 0}`);

  /* ---------- 4. deals ---------- */
  const deals = await listAll('deals', ['dealname','zia_deal_type','zia_placement_status','zia_service_type','zia_talent_email']);
  const seededD = deals.filter(d => d.properties.zia_deal_type);
  const dealCompany = await readAssociations('deals', 'companies', seededD.map(d => d.id));

  const dealName = new Map();
  const dUpdates = [];
  for (const d of seededD) {
    const r = rng('skin:' + d.id);
    const co = (dealCompany.get(d.id) || [])[0];
    const info = co && rename.get(co);
    const coName = info ? info.name : 'Client';
    const tier = d.properties.zia_deal_type;
    const props = {};

    if (d.properties.zia_placement_status) {
      // keep the consultant's name out of the old "Placement — X @ Y" wrapper
      const who = (d.properties.dealname || '').replace(/^Placement — /, '').split(' @ ')[0];
      props.dealname = `Engagement — ${who} @ ${coName}`;
    } else {
      const n = int(r, 1, 2);
      const svc = [];
      while (svc.length < n) { const s = pick(r, SERVICES); if (!svc.includes(s)) svc.push(s); }
      props.dealname = `${coName} — ${PROGRAM[tier] || 'program'}`;
      props.zia_service_type = svc.join(';');
    }
    dealName.set(d.id, props.dealname);
    dUpdates.push({ id: d.id, properties: props });
  }
  const dRes = await batch('deals', 'update', dUpdates, { dryRun });
  console.log(`  deals rewritten: ${dRes.ok || dRes.wouldWrite || 0}`);

  /* ---------- 5. tickets ---------- */
  const tickets = await listAll('tickets', ['subject','zia_ticket_type']);
  const tkDeals = await readAssociations('tickets', 'deals', tickets.map(t => t.id));
  const VERB = { onboarding:'Onboarding', health_check:'30-day health check', at_risk_escalation:'At-risk escalation', offboarding:'Engagement close-out', compliance_review:'Accreditation review' };

  const tkUpdates = [];
  for (const t of tickets) {
    const dealId = (tkDeals.get(t.id) || [])[0];
    const dn = dealId && dealName.get(dealId);
    const verb = VERB[t.properties.zia_ticket_type];
    if (!verb) continue;
    const subject = dn ? `${verb} — ${dn}` : (t.properties.subject || '').replace(/^[^—]+—/, `${verb} —`);
    if (subject !== t.properties.subject) tkUpdates.push({ id: t.id, properties: { subject } });
  }
  const tkRes = await batch('tickets', 'update', tkUpdates, { dryRun });
  console.log(`  tickets rewritten: ${tkRes.ok || tkRes.wouldWrite || 0}`);

  /* ---------- 6. products ---------- */
  const PRODUCT_RENAME = {
    'ZIA-EMB-CORE': ['ZIA Core Program — Single Team', 'Leadership and team-effectiveness program for one team.'],
    'ZIA-EMB-MOM':  ['ZIA Momentum Program — Multi-Team', 'Multi-team leadership development with organizational design support.'],
    'ZIA-EMB-SUM':  ['ZIA Summit Program — Enterprise', 'Enterprise change management, succession planning and executive coaching.'],
    'ZIA-HR-CORE':  ['Consultant Hour — Core', 'Hourly delivery, Core tier.'],
    'ZIA-HR-MOM':   ['Consultant Hour — Momentum', 'Hourly delivery, Momentum tier.'],
    'ZIA-HR-SUM':   ['Consultant Hour — Summit', 'Hourly delivery, Summit tier.'],
    'ZIA-ONB':      ['Organizational Diagnostic (one-time)', 'Baseline assessment, stakeholder interviews and readiness report.'],
  };
  const products = await listAll('products', ['name','hs_sku']);
  const pUpdates = products
    .filter(p => PRODUCT_RENAME[p.properties.hs_sku])
    .map(p => ({ id: p.id, properties: {
      name: PRODUCT_RENAME[p.properties.hs_sku][0],
      description: PRODUCT_RENAME[p.properties.hs_sku][1],
    }}));
  const pRes = await batch('products', 'update', pUpdates, { dryRun });
  console.log(`  products rewritten: ${pRes.ok || pRes.wouldWrite || 0}`);

  // line item names follow the products
  const lineItems = await listAll('line_items', ['name','hs_product_id']);
  const prodName = new Map(products.map(p => [p.id, (PRODUCT_RENAME[p.properties.hs_sku] || [p.properties.name])[0]]));
  const liUpdates = lineItems
    .filter(li => prodName.get(li.properties.hs_product_id) && prodName.get(li.properties.hs_product_id) !== li.properties.name)
    .map(li => ({ id: li.id, properties: { name: prodName.get(li.properties.hs_product_id) } }));
  const liRes = await batch('line_items', 'update', liUpdates, { dryRun });
  console.log(`  line items rewritten: ${liRes.ok || liRes.wouldWrite || 0}`);

  return {
    companies: coRes.ok, contacts: ctRes.ok, deals: dRes.ok,
    tickets: tkRes.ok, products: pRes.ok, lineItems: liRes.ok,
    failed: coRes.failed + ctRes.failed + dRes.failed + tkRes.failed + pRes.failed + liRes.failed,
    wouldWrite: (coRes.wouldWrite||0)+(ctRes.wouldWrite||0)+(dRes.wouldWrite||0)+(tkRes.wouldWrite||0)+(pRes.wouldWrite||0)+(liRes.wouldWrite||0),
  };
};
