#!/usr/bin/env node
/**
 * Seed data generator for the Lumen demo portal.
 *
 * Produces referentially-consistent CSVs at any volume. Every placement points at
 * a talent record that exists and a won deal that exists; every contact points at
 * a company that exists; every date sequence is chronologically possible.
 *
 * Deterministic: the same --seed always produces the same data, so a demo can be
 * torn down and rebuilt identically.
 *
 * Usage:
 *   node generate-seed.js                     # 10,000 records per file
 *   node generate-seed.js --count 2000        # smaller, faster to import
 *   node generate-seed.js --clean             # no data-quality defects injected
 *   node generate-seed.js --seed 42           # different but reproducible variant
 *
 * On defects: by default this injects a controlled, documented set of realistic
 * data-quality problems — duplicates, missing owners, free-text variants of a
 * dropdown value, contradictory dates. That is deliberate. A portal with immaculate
 * data cannot demonstrate the audit tool or the hygiene workflows, and real portals
 * are never clean. SEED-MANIFEST.md records exactly what was injected so findings
 * can be verified rather than taken on trust.
 *
 * Node 18+. No dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const COUNT = intArg('--count', 10000);
const SEED = intArg('--seed', 20260809);
const CLEAN = process.argv.includes('--clean');
const OUT = path.join(__dirname, 'seed');

/* ── deterministic RNG ──────────────────────────────────────────────── */

let _s = SEED >>> 0;
function rnd() {
  // mulberry32 — small, fast, good enough for data shaping and fully reproducible.
  _s = (_s + 0x6D2B79F5) >>> 0;
  let t = _s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;

/** Weighted pick from [[value, weight], ...] */
function weighted(pairs) {
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let r = rnd() * total;
  for (const [value, w] of pairs) { if ((r -= w) <= 0) return value; }
  return pairs[pairs.length - 1][0];
}

/** Two uniforms averaged — clusters toward the middle, like real hour commitments. */
function clustered(min, max) {
  return Math.round(min + ((rnd() + rnd()) / 2) * (max - min));
}

/* ── vocabularies ───────────────────────────────────────────────────── */

const FIRST = ['Aisha','Diego','Lian','Marta','Yusuf','Rina','Tomas','Chidi','Sofia','Nadia','Arun','Bella','Kenji','Isabel','Femi','Priya','Marcus','Dana','Elena','Omar','Hana','Luis','Ingrid','Kwame','Mei','Rafael','Zara','Anders','Fatima','Nikhil','Camila','Boris','Amara','Yuki','Pedro','Leila','Viktor','Sana','Mateo','Nora','Idris','Clara','Hugo','Anika','Tariq','Elsa','Joon','Rosa','Emeka','Lucia','Ravi','Astrid','Malik','Yara','Sven','Divya','Andres','Freya','Bilal','Noemi','Kai','Rania','Oskar','Ines','Tunde','Alba','Hiro','Wren','Salma','Pavel','Ada','Nasir','Greta','Rohan','Marisol','Caleb','Anja','Zane','Thandi','Mikkel','Layla'];
const LAST  = ['Kamau','Ferreira','Chen','Silva','Adeyemi','Patel','Novak','Balogun','Marchetti','Hassan','Krishnan','Okafor','Watanabe','Rojas','Adebayo','Raghunathan','Ellery','Whitfield','Vasquez','Haddad','Kim','Moreau','Lindqvist','Mensah','Zhang','Duarte','Ibrahim','Bakker','Osei','Sharma','Rossi','Petrov','Nkemdi','Tanaka','Alvarez','Farah','Kovacs','Iqbal','Castillo','Bergstrom','Diallo','Weiss','Santos','Mahmood','Nakamura','Olsen','Reyes','Achebe','Fontaine','Sandoval','Lindgren','Okonjo','Baptiste','Mwangi','Novotny','Sorensen','Rahman','Delgado','Eriksen','Yilmaz','Banda','Klein','Torres','Nasser','Andersen','Gupta','Costa','Larsen','Ndiaye','Fischer','Aguilar','Sultana','Bianchi','Nyong','Hoffman','Serrano','Malek','Jansen','Obi','Rivera'];

const PRACTICE_PREFIX = ['Northline','Harbour','Ridgeway','Cedar Point','Meridian','Fieldstone','Alder Creek','Beacon','Wynn','Sinclair','Brookvale','Stonebridge','Lakeshore','Fairmont','Westgate','Kingsley','Redwood','Ashford','Silverbrook','Highpoint','Clearwater','Thornbury','Maplewood','Granville','Oakhurst','Riverstone','Belmont','Windsor','Camden','Prescott','Hollis','Draycott','Ellswood','Nortonville','Cavendish','Bramwell','Tarrant','Lockhart','Everly','Wexford','Summit Ridge','Bayview','Pinehurst','Glenwood','Foxfield'];

const PRACTICE_SUFFIX = {
  dental_solo:      ['Family Dental','Dental Care','Dentistry','Dental Studio','Smile Dentistry'],
  dental_group:     ['Dental Group','Family Dentistry Group','Dental Associates','Dental Care Group'],
  dso:              ['Dental Partners','Dental Collective','Oral Health Partners','Dental Alliance','Smile Partners'],
  orthodontics:     ['Orthodontics','Orthodontic Group','Braces & Aligners','Orthodontic Specialists'],
  oral_surgery:     ['Oral & Maxillofacial Surgery','Oral Surgery Associates','Surgical Arts'],
  perio_endo:       ['Periodontics','Endodontic Associates','Periodontal Specialists','Root Canal Specialists'],
  pediatric_dental: ['Pediatric Dentistry','Children’s Dental','Kids Dental Care'],
  physical_therapy: ['Physical Therapy','Rehab Associates','Sports Rehab','Movement Clinic'],
  medical_specialty:['ENT Associates','Dermatology Group','Specialty Care Partners','Sleep Medicine'],
};

// Weighted toward general dentistry and DSOs, which is where this book actually sits.
const PRACTICE_TYPES = [
  ['dental_solo', 24], ['dental_group', 21], ['dso', 18],
  ['orthodontics', 12], ['perio_endo', 8], ['oral_surgery', 6],
  ['pediatric_dental', 5], ['physical_therapy', 4], ['medical_specialty', 2],
];
const PRACTICE_LABEL = {
  dental_solo: 'General Dentistry — Solo',
  dental_group: 'General Dentistry — Group',
  dso: 'DSO / Multi-Site',
  orthodontics: 'Orthodontics',
  oral_surgery: 'Oral Surgery',
  perio_endo: 'Periodontics / Endodontics',
  pediatric_dental: 'Pediatric Dentistry',
  physical_therapy: 'Physical Therapy',
  medical_specialty: 'Medical — Specialty',
};
// Free-text variants injected as a defect, to evidence why this must be a dropdown.
const PRACTICE_DIRTY = ['dental','Dental','DSO','dental group','General Dentistry ','ortho','Ortho','perio','GP dental'];

// Practice management systems. Market share is roughly realistic — Dentrix and
// Eaglesoft dominate general practice, Denticon skews multi-site.
const PMS = [['Dentrix', 34], ['Eaglesoft', 24], ['Open Dental', 18], ['Curve Dental', 9], ['Denticon', 8], ['Carestream', 7]];
const PMS_DSO = [['Denticon', 38], ['Dentrix', 26], ['Curve Dental', 18], ['Open Dental', 12], ['Eaglesoft', 6]];

const PAYERS = ['Commercial PPO','Medicaid / State Programs','Medicare Advantage','Dental HMO / Capitation','Self-Pay / Membership Plans'];

const ORG_STAGE = [['Scaling / Adding Locations', 38], ['Stable', 31], ['Post-Acquisition Integration', 18], ['Restructuring', 13]];
const TIERS = [['Core', 34], ['Momentum', 52], ['Summit', 14]];
const TIER_RATE = { Core: 12, Momentum: 16, Summit: 22 };

// Coverage band matters more than the talent's own timezone — a practice needs
// someone working its front-office hours.
const TZ = [['US Eastern', 34], ['US Central / Mountain', 30], ['US Pacific', 26], ['Overnight / Overflow', 10]];

// The functions that actually get placed into a dental practice, tiered by the
// nested scope model: Momentum includes Core work, Summit includes Momentum work.
const FN_CORE = ['Insurance Verification','Patient Scheduling','Recall & Reactivation','Front Office / Patient Comms','Records & Charting Support'];
const FN_MOMENTUM = ['Revenue Cycle / Billing','Claims & AR Follow-up','Treatment Coordination','Practice Marketing'];
const FN_SUMMIT = ['Office Management','Operations Leadership'];
const TIER_FUNCTIONS = {
  Core: FN_CORE,
  Momentum: FN_MOMENTUM.concat(FN_CORE.slice(0, 3)),
  Summit: FN_SUMMIT.concat(FN_MOMENTUM.slice(0, 2)),
};

const ASSESSMENT = [['Structured / process-driven', 38], ['Relational / patient-facing', 26], ['Adaptive / cross-functional', 24], ['Autonomous / ownership-oriented', 12]];

const PRACTICE_ROLE = [['Office Manager', 29], ['Owner / Doctor', 27], ['Practice Administrator', 16], ['Billing / RCM Lead', 12], ['Regional / Multi-Site Director', 8], ['COO / Executive (DSO)', 5], ['HR / People Ops', 3]];
const SOURCE_LINE = [['Referral — Client', 28], ['Virtual Talent', 24], ['Content / Organic', 18], ['LumenU', 14], ['Conference / Study Club', 10], ['Referral — Partner / Consultant', 6]];
const BAA_STATUS = [['Executed', 74], ['Sent — Awaiting Signature', 11], ['Renewal Due', 9], ['Not Started', 6]];

const OWNERS = ['caio@lumentalent.example','zane@lumentalent.example','zoe@lumentalent.example','ian@lumentalent.example','vanessa@lumentalent.example','michael@lumentalent.example'];

const DISQUALIFIERS = ['Price shopping','Temp / short-term gap','No ownership intent','Role undefined','No culture investment','No onboarding investment'];
const SHOWCASE_REJECTIONS = ['Communication style','Practice software gap','Coverage hours mismatch','Specialty experience','Rate','Client paused decision'];

// Funnel shape: most deals sit early, few reach the end. Won rate ~34%.
const DEAL_STAGES = [
  ['Alignment Call Booked', 16], ['Role Defined', 12], ['Showcase Scheduled', 9],
  ['Showcase Delivered', 8], ['Agreement Sent', 6], ['Closed Won', 34], ['Closed Lost', 15],
];

/* ── defect rates ───────────────────────────────────────────────────── */

const DEFECTS = CLEAN ? {} : {
  missingOwner: 0.06,        // records nobody is accountable for
  missingPracticeType: 0.04, // segment analysis silently incomplete
  freeTextPracticeType: 0.03,// the dropdown-vs-text argument, evidenced
  duplicateContact: 0.025,   // same person, second record
  missingPhone: 0.11,        // common and mostly benign
  contradictoryDates: 0.012, // status Ended with no end date
  missingFitScore: 0.05,     // stage gate was bypassed before it existed
};
const injected = {};
function defect(kind) {
  const rate = DEFECTS[kind];
  if (!rate) return false;
  if (chance(rate)) { injected[kind] = (injected[kind] || 0) + 1; return true; }
  return false;
}

/* ── date helpers ───────────────────────────────────────────────────── */

const TODAY = new Date('2026-08-09T00:00:00Z');
const DAY = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const daysAgo = (n) => new Date(TODAY.getTime() - n * DAY);
const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY);

/* ── CSV ────────────────────────────────────────────────────────────── */

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function writeCsv(file, headers, rows) {
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => csvCell(r[h])).join(','));
  const p = path.join(OUT, file);
  fs.writeFileSync(p, lines.join('\n') + '\n');
  console.log(`  ${file.padEnd(26)} ${rows.length.toLocaleString().padStart(8)} rows   ${(fs.statSync(p).size / 1048576).toFixed(2)} MB`);
}

/* ── generation ─────────────────────────────────────────────────────── */

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 28);
}

function buildCompanies(n) {
  const rows = [];
  const seenDomain = new Set();
  for (let i = 0; i < n; i++) {
    const type = weighted(PRACTICE_TYPES);
    const name = `${pick(PRACTICE_PREFIX)} ${pick(PRACTICE_SUFFIX[type])}`;
    let domain = `${slug(name)}.example`;
    // Name collisions are inevitable at volume; make domains unique so imports
    // associate correctly rather than silently merging two organizations.
    if (seenDomain.has(domain)) domain = `${slug(name)}${i}.example`;
    seenDomain.add(domain);

    let typeLabel = PRACTICE_LABEL[type];
    if (defect('freeTextPracticeType')) typeLabel = pick(PRACTICE_DIRTY);
    else if (defect('missingPracticeType')) typeLabel = '';

    // Location count is the strongest predictor of deal size, and it varies
    // enormously by segment — a DSO buys seats per site, a solo practice buys one.
    const locations = type === 'dso' ? int(4, 42)
      : type === 'dental_group' ? int(2, 5)
      : type === 'orthodontics' ? int(1, 4)
      : 1;
    const employees = locations > 1 ? locations * int(9, 18) : int(5, 22);

    // Multi-site groups skew toward enterprise platforms; solo practices don't.
    const pms = weighted(locations > 3 ? PMS_DSO : PMS);

    const baa = weighted(BAA_STATUS);
    const baaEffective = baa === 'Not Started' ? null : daysAgo(int(30, 900));
    const created = daysAgo(int(1, 730));

    rows.push({
      'Name': name,
      'Company Domain Name': domain,
      'Practice Type': typeLabel,
      'Number of Locations': locations,
      'Practice Management System': pms,
      'Organizational Stage': weighted(ORG_STAGE),
      'Number of Employees': employees,
      'BAA Status': baa,
      'BAA Effective Date': baaEffective ? iso(baaEffective) : '',
      // Renewal one year on. A meaningful share fall in the past, which is exactly
      // the exposure the compliance dashboard exists to surface.
      'BAA Renewal Date': baaEffective ? iso(addDays(baaEffective, 365)) : '',
      'Last Risk Review': baa === 'Executed' && chance(0.72) ? iso(daysAgo(int(20, 500))) : '',
      'Referrals Generated': chance(0.24) ? int(1, 4) : 0,
      'Company owner': defect('missingOwner') ? '' : pick(OWNERS),
      'Create Date': iso(created),
      '_type': type,
      '_domain': domain,
      '_pms': pms,
      '_locations': locations,
    });
  }
  return rows;
}

function buildClientContacts(n, companies) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    // Power-law-ish: a minority of companies hold most of the contacts, which is
    // how a real CRM looks. Squaring the uniform biases toward the earlier slice.
    const idx = Math.floor(Math.pow(rnd(), 2) * companies.length);
    const co = companies[idx];
    const first = pick(FIRST), last = pick(LAST);
    rows.push({
      'First Name': first,
      'Last Name': last,
      'Email': `${first.toLowerCase()}.${last.toLowerCase()}${i}@${co._domain}`,
      'Company Domain Name': co._domain,
      'Contact Type': 'Client Contact',
      'Practice Role': weighted(PRACTICE_ROLE),
      'Source Line': weighted(SOURCE_LINE),
      'Phone Number': defect('missingPhone') ? '' : `+1${int(200, 989)}${int(2000000, 9999999)}`,
      'Contact owner': defect('missingOwner') ? '' : (co['Company owner'] || pick(OWNERS)),
      'Create Date': iso(daysAgo(int(1, 700))),
    });

    if (defect('duplicateContact') && rows.length > 1) {
      const src = rows[rows.length - 1];
      rows.push(Object.assign({}, src, {
        'Email': src['Email'].replace('@', '+dup@'),
        'Phone Number': '',
        'Contact owner': '',
      }));
      i++;
    }
  }
  return rows.slice(0, n);
}

function buildTalent(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const tier = weighted(TIERS);
    const pool = TIER_FUNCTIONS[tier];
    const fns = [pick(pool), pick(pool)].filter((v, k, a) => a.indexOf(v) === k);

    // Status distribution reflects a working bench, not an idealized one.
    const status = weighted([['Placed', 46], ['Bench-Ready', 31], ['In Assessment', 15], ['Inactive', 8]]);
    const placed = status === 'Placed';
    const capacity = clustered(20, 40);

    // Most talent knows one platform well and a second passably. Claiming
    // fluency in five would be the giveaway that this data is fabricated.
    const primaryPms = weighted(PMS);
    const pmsList = chance(0.55) ? [primaryPms, weighted(PMS)].filter((v, k, a) => a.indexOf(v) === k) : [primaryPms];

    const payers = [pick(PAYERS)];
    if (chance(0.48)) payers.push(pick(PAYERS));

    // Compliance: training runs on a one-year cycle. A realistic slice has
    // lapsed or is about to — which is the point of tracking it at all.
    const trainingDone = status === 'In Assessment' && chance(0.6) ? null : daysAgo(int(10, 430));
    const trainingExpiry = trainingDone ? addDays(trainingDone, 365) : null;
    let complianceStatus = 'Not Started';
    if (trainingExpiry) {
      const daysLeft = Math.floor((trainingExpiry - TODAY) / DAY);
      complianceStatus = daysLeft < 0 ? 'Lapsed' : daysLeft <= 30 ? 'Expiring Soon' : 'Clear';
    }

    rows.push({
      'First Name': pick(FIRST),
      'Last Name': pick(LAST),
      'Email': `talent${i}@lumentalent.example`,
      'Contact Type': 'Talent',
      'Tier Certified': tier,
      'Clinical-Administrative Function': fns.join(';'),
      'Practice Software Proficiency': pmsList.join(';'),
      'Payer Experience': payers.filter((v, k, a) => a.indexOf(v) === k).join(';'),
      'Coverage Band': weighted(TZ),
      // Placed talent still holds residual capacity; bench talent holds all of it.
      'Available Hours / Week': placed ? int(0, 8) : capacity,
      'Cost Rate (hourly)': +(TIER_RATE[tier] * (0.42 + rnd() * 0.14)).toFixed(2),
      'Bench Status': status,
      'Assessment Profile': weighted(ASSESSMENT),
      'Assessment Date': status === 'In Assessment' ? '' : iso(daysAgo(int(20, 700))),
      'HIPAA Training Completed': trainingDone ? iso(trainingDone) : '',
      'HIPAA Training Expires': trainingExpiry ? iso(trainingExpiry) : '',
      'Background Check Completed': trainingDone && chance(0.93) ? iso(addDays(trainingDone, -int(3, 40))) : '',
      'Compliance Status': complianceStatus,
      'Source Line': weighted([['Virtual Talent', 74], ['Referral — Partner / Consultant', 19], ['Content / Organic', 7]]),
      'Contact owner': defect('missingOwner') ? '' : pick(OWNERS),
      'Create Date': iso(daysAgo(int(1, 900))),
      '_tier': tier,
      '_status': status,
      '_pms': pmsList,
      '_compliance': complianceStatus,
      '_index': i,
    });
  }
  return rows;
}

function buildAcquisitionDeals(n, companies, forceWon) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const co = companies[Math.floor(Math.pow(rnd(), 1.6) * companies.length)];
    const stage = forceWon ? 'Closed Won' : weighted(DEAL_STAGES);
    const tier = weighted(TIERS);
    const hours = clustered(15, 40);
    const seats = co._type === 'dental_dso' ? weighted([[1, 40], [2, 30], [3, 20], [4, 10]]) : weighted([[1, 78], [2, 18], [3, 4]]);
    const rate = TIER_RATE[tier];
    const closed = stage.startsWith('Closed');

    // Open deals close in the future; closed deals closed in the past. Getting this
    // backwards is the single most common flaw in generated CRM data.
    const closeDate = closed ? daysAgo(int(1, 600)) : addDays(TODAY, int(3, 120));

    const won = stage === 'Closed Won';
    const lost = stage === 'Closed Lost';
    const roleDefined = ['Alignment Call Booked'].includes(stage) ? false : true;

    let fit;
    if (lost) fit = int(-8, 5);
    else if (won) fit = int(9, 16);
    else fit = int(3, 14);
    if (defect('missingFitScore')) fit = '';

    // What the practice actually needs covered, drawn from the tier's scope.
    const fnPool = TIER_FUNCTIONS[tier];
    const needed = [pick(fnPool), pick(fnPool)].filter((v, k, a) => a.indexOf(v) === k);

    // Showcase data exists only once a showcase has actually happened.
    const showcased = ['Showcase Delivered', 'Agreement Sent', 'Closed Won'].includes(stage) || (lost && chance(0.4));
    const presented = showcased ? int(2, 4) : '';
    const rejected = showcased && !won ? pick(SHOWCASE_REJECTIONS) : '';

    rows.push({
      'Deal Name': `${co['Name']} — ${tier} ${seats > 1 ? seats + ' seats' : 'embed'}`,
      'Pipeline': 'Lumen — Client Acquisition',
      'Deal Stage': stage,
      'Amount': Math.round(rate * hours * 4.33 * 12 * seats),
      'Close Date': iso(closeDate),
      'Associated Company': co._domain,
      'Tier Requested': tier,
      'Function Needed': needed.join(';'),
      'Seats Committed': seats,
      'Hours per Week': hours,
      'Target Embed Date': won ? iso(addDays(closeDate, int(7, 28))) : '',
      'Role Definition Complete': roleDefined ? 'true' : 'false',
      'Candidates Presented': presented,
      'Showcase Rejection Reason': rejected,
      'Fit Score': fit,
      'Disqualifier Reason': lost ? pick(DISQUALIFIERS) : '',
      'Deal owner': defect('missingOwner') ? '' : (co['Company owner'] || pick(OWNERS)),
      '_won': won,
      '_co': co,
      '_tier': tier,
      '_hours': hours,
      '_seats': seats,
      '_close': closeDate,
      '_functions': needed,
    });
  }
  return rows;
}

function buildPlacements(n, deals, talent) {
  const wonDeals = deals.filter((d) => d._won);
  const placeable = talent.filter((t) => t._status === 'Placed' || t._status === 'Bench-Ready');
  if (!wonDeals.length || !placeable.length) return [];

  const rows = [];
  let ti = 0;
  outer:
  for (const deal of wonDeals) {
    for (let s = 0; s < deal._seats; s++) {
      if (rows.length >= n) break outer;

      const t = placeable[ti++ % placeable.length];
      const start = addDays(deal._close, int(5, 30));
      if (start > TODAY) continue;

      const ageDays = Math.floor((TODAY - start) / DAY);
      // Churn probability rises with tenure; ~25% of the book has ended.
      const ended = chance(Math.min(0.42, 0.06 + ageDays / 1400));
      const atRisk = !ended && chance(0.11);

      let endDate = ended ? iso(addDays(start, int(60, Math.max(70, ageDays)))) : '';
      let status = ended ? 'Ended' : atRisk ? 'At Risk' : 'Active';
      if (ended && defect('contradictoryDates')) endDate = '';

      const health = ended ? int(12, 38) : atRisk ? int(20, 42) : int(58, 96);
      const lastCheckin = ended
        ? iso(addDays(start, int(30, Math.max(35, ageDays - 10))))
        : iso(daysAgo(atRisk ? int(35, 90) : int(2, 34)));

      const stage = ended ? 'Ended'
        : ageDays > 45 ? 'Steady State'
        : ageDays > 30 ? '30-Day Review'
        : ageDays > 7 ? 'Week-1 Check-in'
        : 'Kickoff Scheduled';

      // Access is granted at embed start and should be revoked when it ends.
      // A deliberate minority of ended placements have no revocation date —
      // the single most consequential finding the compliance dashboard surfaces.
      const accessGranted = iso(addDays(start, -int(0, 4)));
      const accessRevoked = ended && endDate && chance(0.87) ? endDate : '';

      rows.push({
        'Deal Name': `Placement — ${t['First Name']} ${t['Last Name']} @ ${deal._co['Name']}`,
        'Pipeline': 'Lumen — Placements (Delivery)',
        'Deal Stage': stage,
        'Close Date': iso(start),
        'Associated Company': deal._co._domain,
        'Placement Tier': deal._tier,
        'Hourly Rate (client)': TIER_RATE[deal._tier],
        'Hours per Week': deal._hours,
        'Placement Status': status,
        'Embed Start Date': iso(start),
        'Embed End Date': endDate,
        'Placement Health Score': health,
        'Last Check-in Date': lastCheckin,
        'Role Documentation Current': stage === 'Steady State' ? 'true' : (chance(0.4) ? 'true' : 'false'),
        'Practice System Access Granted': accessGranted,
        'Practice System Access Revoked': accessRevoked,
        'Talent Email': t['Email'],
        'Practice Management System': deal._co._pms,
        'Deal owner': deal['Deal owner'] || pick(OWNERS),
      });
    }
  }
  return rows;
}

/* ── manifest ───────────────────────────────────────────────────────── */

function writeManifest(counts, placements) {
  const active = placements.filter((p) => p['Placement Status'] === 'Active').length;
  const risk = placements.filter((p) => p['Placement Status'] === 'At Risk').length;
  const ended = placements.filter((p) => p['Placement Status'] === 'Ended').length;
  const mrr = placements
    .filter((p) => p['Placement Status'] !== 'Ended')
    .reduce((s, p) => s + p['Hourly Rate (client)'] * p['Hours per Week'] * 4.33, 0);

  const lines = [
    '# Seed data manifest',
    '',
    `Generated ${new Date().toUTCString()} · seed \`${SEED}\` · ${CLEAN ? 'clean mode' : 'defects injected'}`,
    '',
    'Regenerate identically with:',
    '',
    '```',
    `node generate-seed.js --count ${COUNT} --seed ${SEED}${CLEAN ? ' --clean' : ''}`,
    '```',
    '',
    '## Volumes',
    '',
    '| File | Rows |',
    '|---|---:|',
    ...Object.entries(counts).map(([f, c]) => `| \`${f}\` | ${c.toLocaleString()} |`),
    '',
    '## Placement book',
    '',
    `- Active: **${active.toLocaleString()}**`,
    `- At risk: **${risk.toLocaleString()}**`,
    `- Ended: **${ended.toLocaleString()}**`,
    `- Monthly recurring value of the live book: **$${Math.round(mrr).toLocaleString()}**`,
    '',
    '## Referential guarantees',
    '',
    '- Every contact references a company domain that exists in `companies.csv`.',
    '- Every placement references a won deal and a talent record that both exist.',
    '- Placement start dates always fall after their deal close date.',
    '- Open deals close in the future; closed deals closed in the past.',
    '- Health scores are consistent with placement status, not random.',
    '',
  ];

  if (CLEAN) {
    lines.push('## Data quality', '', 'Clean mode — no defects injected.', '');
  } else {
    lines.push(
      '## Injected defects',
      '',
      'Deliberate, and documented here so audit findings can be verified rather than trusted.',
      'A portal with immaculate data cannot demonstrate the audit tool or the hygiene workflows,',
      'and no real portal is clean.',
      '',
      '| Defect | Records | What it demonstrates |',
      '|---|---:|---|',
      `| Missing owner | ${(injected.missingOwner || 0).toLocaleString()} | Records that fall out of every owner-filtered report |`,
      `| Missing practice type | ${(injected.missingPracticeType || 0).toLocaleString()} | Segment analysis silently incomplete |`,
      `| Free-text practice type | ${(injected.freeTextPracticeType || 0).toLocaleString()} | Why the property must be a dropdown — "dental", "Dental", "DSO" become separate rows |`,
      `| Duplicate contacts | ${(injected.duplicateContact || 0).toLocaleString()} | Two-sided databases duplicate faster than single-audience ones |`,
      `| Missing phone | ${(injected.missingPhone || 0).toLocaleString()} | Common, mostly benign — useful contrast against defects that matter |`,
      `| Contradictory dates | ${(injected.contradictoryDates || 0).toLocaleString()} | Status Ended with no end date — a validation rule would have blocked it |`,
      `| Missing fit score | ${(injected.missingFitScore || 0).toLocaleString()} | Deals that predate the stage gate |`,
      '',
      'Run `node audit.js` after import; these are the findings it should surface.',
      ''
    );
  }

  fs.writeFileSync(path.join(OUT, 'SEED-MANIFEST.md'), lines.join('\n'));
}

/* ── main ───────────────────────────────────────────────────────────── */

(function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  console.log(`\n  Generating seed data — ${COUNT.toLocaleString()} records per file`);
  console.log(`  seed ${SEED} · ${CLEAN ? 'clean' : 'defects injected'}\n`);

  const companies = buildCompanies(COUNT);
  const clients = buildClientContacts(COUNT, companies);
  const talent = buildTalent(COUNT);
  const deals = buildAcquisitionDeals(COUNT, companies);

  // Placements are derived, not invented: each one needs a won deal and a seat on
  // it. At a realistic ~34% win rate the natural yield falls short of the target,
  // so top up with additional won deals rather than fabricating orphan placements.
  // Referential integrity is worth more than a round number.
  let placements = buildPlacements(COUNT, deals, talent);
  let topUps = 0;
  while (placements.length < COUNT && topUps < 40) {
    const shortfall = COUNT - placements.length;
    const extra = buildAcquisitionDeals(Math.ceil(shortfall / 1.4) + 50, companies, true);
    deals.push(...extra);
    placements = buildPlacements(COUNT, deals, talent);
    topUps++;
  }

  const strip = (rows) => rows.map((r) => {
    const o = {};
    for (const k of Object.keys(r)) if (!k.startsWith('_')) o[k] = r[k];
    return o;
  });

  const cs = strip(companies), cl = strip(clients), tl = strip(talent), dl = strip(deals), pl = strip(placements);

  writeCsv('companies.csv', Object.keys(cs[0]), cs);
  writeCsv('contacts_clients.csv', Object.keys(cl[0]), cl);
  writeCsv('contacts_talent.csv', Object.keys(tl[0]), tl);
  writeCsv('deals_acquisition.csv', Object.keys(dl[0]), dl);
  writeCsv('deals_placements.csv', Object.keys(pl[0]), pl);

  writeManifest({
    'companies.csv': cs.length,
    'contacts_clients.csv': cl.length,
    'contacts_talent.csv': tl.length,
    'deals_acquisition.csv': dl.length,
    'deals_placements.csv': pl.length,
  }, placements);

  console.log(`\n  SEED-MANIFEST.md written — import in the order listed there.\n`);
})();

function intArg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const v = parseInt(process.argv[i + 1], 10);
  return Number.isFinite(v) ? v : fallback;
}
