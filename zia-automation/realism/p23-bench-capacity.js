#!/usr/bin/env node
'use strict';
/**
 * P23 — restore a believable bench.
 *
 * THE DEFECT
 * P22 gave every orphaned engagement a real consultant, which was right — but it did
 * it by consuming the entire bench. The roster ended at **146 placed of 160, 91.3%
 * utilisation, nobody available**.
 *
 * A consultancy at 91% has no capacity to win anything, no cover for illness, and
 * nothing to report on a bench dashboard. Professional services runs **70-85%**; the
 * gap is not waste, it is how you say yes to the next client. It also happens to be
 * where one of the strongest findings in this build lives — idle bench is unearned
 * margin, and you cannot show that with an empty bench.
 *
 * THE FIX
 * Hire. Add consultants at the bench end until utilisation lands near 78%, with the
 * same tier / coverage / compliance shape as the existing roster so the new records
 * are indistinguishable from the old ones.
 *
 *   node realism/p23-bench-capacity.js                 dry run
 *   node realism/p23-bench-capacity.js --apply         hire
 *   node realism/p23-bench-capacity.js --target 0.75   aim at a different utilisation
 */
const { api, listAll, readAssociations, ASSOC } = require('../lib/hubspot');

const APPLY = process.argv.includes('--apply');
const tIdx = process.argv.indexOf('--target');
const TARGET_UTIL = tIdx > -1 ? +process.argv[tIdx + 1] : 0.78;

// Bill rates from P18; cost is ~55% of bill.
const BILL = { core: 85, momentum: 110, summit: 145 };
const TIER_MIX = ['core', 'core', 'momentum', 'momentum', 'momentum', 'summit'];
const COVERAGE = ['US Eastern', 'US Eastern', 'US Central / Mountain', 'US Pacific', 'Overnight / Overflow'];
const COMPLIANCE = ['clear', 'clear', 'clear', 'clear', 'expiring_soon', 'not_started'];
const BENCH = ['bench_ready', 'bench_ready', 'bench_ready', 'in_assessment'];

const FIRST = `Amara Priya Ines Sofia Nadia Yuki Leila Mei Rina Aisha Freya Dana Marisol Ingrid
Tomas Marcus Idris Kenji Caleb Salma Wren Kwame Elena Hana Omar Nina Rafael Petra Anya Josef
Lucia Mateo Zara Theo Isla Arjun Noor Emeka Sana Bruno Clara Devi Ravi Talia Yusuf Greta`.trim().split(/\s+/);
const LAST = `Adebayo Achebe Kovacs Bianchi Lindgren Vasquez Weiss Okonjo Farah Duarte Delgado
Tanaka Sandoval Okafor Mwangi Lindqvist Diallo Yilmaz Petrov Novak Haddad Rahman Sorensen
Bergman Costa Nakamura Osei Fernandes Kaur Almeida Varga Ibrahim Moreau Rossi Silva Ahmed`.trim().split(/\s+/);

const seeded = s => {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
};
const pick = (r, a) => a[Math.floor(r() * a.length)];

(async () => {
  const contacts = await listAll('contacts', ['email', 'zia_contact_type', 'zia_bench_status', 'zia_tier']);
  const talent = contacts.filter(c => c.properties.zia_contact_type === 'talent');
  const placed = talent.filter(c => c.properties.zia_bench_status === 'placed').length;
  const util = placed / talent.length;

  console.log(`consultants ${talent.length} · placed ${placed} · utilisation ${(util * 100).toFixed(1)}%`);
  console.log(`target utilisation ${(TARGET_UTIL * 100).toFixed(0)}%`);

  const wanted = Math.max(0, Math.round(placed / TARGET_UTIL) - talent.length);
  if (!wanted) { console.log('already at or below target — no hiring needed'); return; }

  // Contact ceiling is a hard free-tier limit; never plan past it.
  const headroom = 1000 - contacts.length;
  const hire = Math.min(wanted, Math.max(0, headroom - 5));
  console.log(`hiring ${hire} consultants  (want ${wanted}, contact headroom ${headroom})`);

  const existing = new Set(talent.map(c => c.properties.email));
  const creates = [];
  for (let i = 0; i < hire; i++) {
    const rnd = seeded(`hire-${i}-${talent.length}`);
    let first, last, email, guard = 0;
    do {
      first = pick(rnd, FIRST); last = pick(rnd, LAST);
      email = `${first}.${last}`.toLowerCase() + '@ziaod.com';
    } while (existing.has(email) && ++guard < 60);
    existing.add(email);

    const tier = pick(rnd, TIER_MIX);
    creates.push({
      properties: {
        firstname: first, lastname: last, email,
        zia_contact_type: 'talent',
        zia_tier: tier,
        zia_bench_status: pick(rnd, BENCH),
        zia_compliance_status: pick(rnd, COMPLIANCE),
        zia_coverage_band: pick(rnd, COVERAGE),
        zia_cost_rate: String(Math.round(BILL[tier] * 0.55)),
        zia_hours_per_week: String(30 + Math.floor(rnd() * 11)),
      },
    });
  }

  const projected = placed / (talent.length + creates.length);
  console.log(`projected utilisation after hiring: ${(projected * 100).toFixed(1)}%`);
  console.log('samples:');
  for (const c of creates.slice(0, 5)) {
    console.log(`  ${(c.properties.firstname + ' ' + c.properties.lastname).padEnd(24)}`
      + ` ${c.properties.zia_tier.padEnd(9)} ${c.properties.zia_bench_status.padEnd(13)} ${c.properties.zia_coverage_band}`);
  }

  if (!APPLY) { console.log('\ndry run — re-run with --apply to hire.'); return; }

  const made = [];
  for (let i = 0; i < creates.length; i += 100) {
    const r = await api('POST', '/crm/v3/objects/contacts/batch/create', { inputs: creates.slice(i, i + 100) });
    made.push(...(r.results || []));
  }
  console.log(`\ncreated ${made.length} consultants`);

  // Attach them to the ZIA operating company, the way the existing roster is modelled.
  const companies = await listAll('companies', ['name']);
  const zia = companies.find(c => /^ZIA\b/i.test(c.properties.name || ''));
  if (zia && made.length) {
    const inputs = made.map(m => ({
      from: { id: m.id }, to: { id: String(zia.id) },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.CONTACT_TO_COMPANY }],
    }));
    for (let i = 0; i < inputs.length; i += 100) {
      await api('POST', '/crm/v4/associations/contacts/companies/batch/create', { inputs: inputs.slice(i, i + 100) });
    }
    console.log(`associated ${inputs.length} to ${zia.properties.name}`);
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
