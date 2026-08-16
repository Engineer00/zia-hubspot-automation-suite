#!/usr/bin/env node
'use strict';
/**
 * P15 — company name repair.
 *
 * THE DEFECT
 * The original seed drew company names from a small pool, collided constantly, and
 * resolved the collisions by appending a counter. The portal ended up holding names
 * like `Linden Labs 39`, `Cobalt Industries 78`, `Norbury Medical Group 5`.
 *
 * No company is named that. It is the single most obvious tell that a dataset is
 * generated — a reviewer spots it before they read a single number, and once they
 * have spotted it they distrust everything else on the screen.
 *
 * THE FIX
 * Rebuild each offending name from a much larger prefix pool, with a suffix drawn to
 * match the company's actual sector, and guarantee global uniqueness against every
 * name already in the portal. Deterministic: seeded per record id, so re-running
 * produces the same names and the pass is safe to repeat.
 *
 *   node realism/p15-company-names.js            dry run — prints the rename plan
 *   node realism/p15-company-names.js --apply    perform the rename
 */
const { listAll, batch } = require('../lib/hubspot');

const APPLY = process.argv.includes('--apply');

// Deterministic RNG, seeded per record — same input, same name, every run.
const seeded = id => {
  let h = 2166136261;
  for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
};

// British-and-American place-ish words, the register real mid-market firms actually use.
const PREFIX = `Alderton Ashgrove Bramley Brayford Calder Camborne Cardington Chilton Claremont
Copperfield Cranleigh Dunbarton Eastvale Elmsworth Fairhaven Fenwick Glenmore Granton Harlow
Hartwell Havering Kelbrook Kingsley Langford Ledbury Marlow Merrick Netherby Northgate Oakhurst
Pemberton Quarry Ravensworth Redhill Rushmore Selby Sheldon Silverton Stanmore Sudbury Thornbury
Tilbury Vernon Wexford Whitmore Winterbourne Wycombe Yardley Ashcombe Belmont Carlton Darnley
Eversholt Fairbourne Greystone Holloway Ingleby Kirkstall Lancing Mowbray Newquay Orpington
Pickford Radcliffe Sandhurst Tenbury Upton Wadebridge Yateley Amberly Blackwood Cheswick
Draperfield Edgemoor Fallowfield Granville Hillcrest Ironside Juniper Kestrel Larkfield
Millbrook Northwind Oakfield Priestly Quenby Rosemont Stonebridge Thatcham Underhill Vantry
Westbury Yarmouth Ashdown Brookvale Cedarhill Dunmoor Ellesmere Foxglove`.trim().split(/\s+/);

// Suffix pools per sector, so a logistics firm is not called "Care Group".
const SUFFIX = {
  technology:           ['Systems', 'Technologies', 'Labs', 'Digital', 'Software'],
  professional_services:['Partners', 'Associates', 'Consulting', 'Advisory', 'Group'],
  healthcare:           ['Health', 'Medical Group', 'Care Group', 'Health Partners', 'Clinical Group'],
  manufacturing:        ['Industries', 'Manufacturing', 'Works', 'Fabrication', 'Engineering'],
  logistics:            ['Logistics', 'Freight', 'Distribution', 'Supply Co', 'Transport'],
  financial_services:   ['Financial', 'Wealth Partners', 'Capital', 'Assurance', 'Trust'],
  nonprofit:            ['Foundation', 'Trust', 'Initiative', 'Alliance', 'Society'],
  retail_consumer:      ['Retail Group', 'Brands', 'Stores', 'Trading Co', 'Market Group'],
  education:            ['Academy', 'Education Group', 'Institute', 'Learning Group', 'Schools Trust'],
  construction:         ['Construction', 'Builders', 'Contracting', 'Developments', 'Civil Group'],
};
const FALLBACK = ['Group', 'Partners', 'Holdings', 'Company', 'Enterprises'];

(async () => {
  console.log('pulling companies...');
  const companies = await listAll('companies', ['name', 'domain', 'zia_industry']);

  const trailingNumber = /\s+\d+$/;
  const broken = companies.filter(c => trailingNumber.test(c.properties.name || ''));

  // Every name already in use, so replacements collide with nothing.
  const taken = new Set(companies.map(c => (c.properties.name || '').trim().toLowerCase()));
  for (const c of broken) taken.delete((c.properties.name || '').trim().toLowerCase());

  console.log(`companies: ${companies.length}   with a trailing counter: ${broken.length}`);
  if (!broken.length) { console.log('nothing to repair'); return; }

  const updates = [];
  for (const c of broken) {
    const rnd = seeded(c.id);
    const pool = SUFFIX[c.properties.zia_industry] || FALLBACK;

    let name = null;
    // Deterministic search: walk the pools until an unused combination appears.
    for (let attempt = 0; attempt < 4000 && !name; attempt++) {
      const p = PREFIX[Math.floor(rnd() * PREFIX.length)];
      const s = pool[Math.floor(rnd() * pool.length)];
      const candidate = `${p} ${s}`;
      if (!taken.has(candidate.toLowerCase())) name = candidate;
    }
    if (!name) { console.warn(`  ! no free name for ${c.properties.name}`); continue; }

    taken.add(name.toLowerCase());
    updates.push({ id: c.id, properties: { name }, __was: c.properties.name });
  }

  console.log('\nrename plan (first 20):');
  for (const u of updates.slice(0, 20)) console.log(`  ${u.__was.padEnd(34)} ->  ${u.properties.name}`);
  if (updates.length > 20) console.log(`  … and ${updates.length - 20} more`);

  // ---- cascade -----------------------------------------------------------
  // The company name is denormalised into deal names (`Engagement — X @ Company`)
  // and ticket subjects. Renaming the company alone would leave the old name
  // visible on 200+ records — a worse inconsistency than the counter it replaced.
  const rename = new Map(updates.map(u => [u.__was, u.properties.name]));

  const deals = await listAll('deals', ['dealname']);
  const dealUpdates = [];
  for (const d of deals) {
    const name = d.properties.dealname || '';
    for (const [was, now] of rename) {
      if (name.includes(was)) { dealUpdates.push({ id: d.id, properties: { dealname: name.split(was).join(now) } }); break; }
    }
  }

  const tickets = await listAll('tickets', ['subject']);
  const ticketUpdates = [];
  for (const t of tickets) {
    const subj = t.properties.subject || '';
    for (const [was, now] of rename) {
      if (subj.includes(was)) { ticketUpdates.push({ id: t.id, properties: { subject: subj.split(was).join(now) } }); break; }
    }
  }

  console.log(`\ncascade: ${dealUpdates.length} deal names · ${ticketUpdates.length} ticket subjects`);

  if (!APPLY) { console.log(`\ndry run — ${updates.length} renames. Re-run with --apply to write.`); return; }

  const r = await batch('companies', 'update', updates.map(({ id, properties }) => ({ id, properties })));
  console.log(`\nrenamed companies ${r.ok}   failed ${r.failed}`);
  const rd = await batch('deals', 'update', dealUpdates);
  console.log(`renamed deals     ${rd.ok}   failed ${rd.failed}`);
  const rt = await batch('tickets', 'update', ticketUpdates);
  console.log(`renamed tickets   ${rt.ok}   failed ${rt.failed}`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
