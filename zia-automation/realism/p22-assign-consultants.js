#!/usr/bin/env node
'use strict';
/**
 * P22 — give every engagement a real consultant, within human capacity.
 *
 * THE DEFECT
 * 153 active engagements contract 4,288 hours a week, but only 87 of the consultants
 * they name still exist — the rest were archived in the rescale. So the delivery side
 * says "4,288 hrs/week" while the bench says 87 people, which reads as 49 hours each
 * and invites exactly the question it should survive: *who is actually doing this work?*
 *
 * THE FIX
 * Reassign every orphaned engagement to a real consultant who has room for it, capped
 * at **40 contracted hours per week per person**. Tier is respected — a Summit
 * engagement goes to a Summit consultant where one has capacity — and compliance-blocked
 * consultants are never assigned, because WF-06 is holding them off the bench for a
 * reason.
 *
 * If capacity runs out, engagements are left unassigned rather than overloading someone.
 * An honest gap beats an impossible roster.
 *
 *   node realism/p22-assign-consultants.js            dry run
 *   node realism/p22-assign-consultants.js --apply    reassign
 */
const { listAll, batch, api, ASSOC } = require('../lib/hubspot');

const APPLY = process.argv.includes('--apply');
const MAX_HOURS = 40;
const BLOCKED = ['lapsed', 'not_started'];

(async () => {
  const deals = await listAll('deals', ['dealname', 'zia_deal_type', 'zia_placement_status',
    'zia_talent_email', 'zia_hours_per_week']);
  const contacts = await listAll('contacts', ['email', 'firstname', 'lastname',
    'zia_contact_type', 'zia_tier', 'zia_compliance_status', 'zia_bench_status']);

  const talent = contacts.filter(c => c.properties.zia_contact_type === 'talent');
  const byEmail = new Map(talent.map(c => [c.properties.email, c]));
  const placements = deals.filter(d => d.properties.zia_deal_type && d.properties.zia_placement_status);
  const active = placements.filter(d => d.properties.zia_placement_status === 'active');

  // Current load per consultant, from engagements that already point at a real person.
  const load = new Map(talent.map(c => [c.properties.email, 0]));
  const orphans = [];
  for (const d of active) {
    const email = d.properties.zia_talent_email;
    const hrs = +d.properties.zia_hours_per_week || 0;
    if (email && byEmail.has(email)) load.set(email, (load.get(email) || 0) + hrs);
    else orphans.push(d);
  }

  console.log(`active engagements        : ${active.length}`);
  console.log(`  already staffed properly: ${active.length - orphans.length}`);
  console.log(`  orphaned (missing person): ${orphans.length}`);

  const assignable = talent.filter(c => !BLOCKED.includes(c.properties.zia_compliance_status));
  console.log(`assignable consultants    : ${assignable.length} of ${talent.length}`
    + ` (${talent.length - assignable.length} held by compliance)`);

  // Biggest engagements first, so the hardest ones to place get first pick of capacity.
  orphans.sort((a, b) => (+b.properties.zia_hours_per_week || 0) - (+a.properties.zia_hours_per_week || 0));

  const dealUpdates = [], assoc = [];
  let unplaced = 0;
  for (const d of orphans) {
    const hrs = +d.properties.zia_hours_per_week || 0;
    const tier = d.properties.zia_deal_type;

    // Prefer a tier match with room; fall back to anyone with room.
    const room = c => (load.get(c.properties.email) || 0) + hrs <= MAX_HOURS;
    const pool = assignable.filter(room);
    const sameTier = pool.filter(c => c.properties.zia_tier === tier);
    const candidates = (sameTier.length ? sameTier : pool)
      .sort((a, b) => (load.get(a.properties.email) || 0) - (load.get(b.properties.email) || 0));

    if (!candidates.length) { unplaced++; continue; }
    const chosen = candidates[0];
    const email = chosen.properties.email;
    load.set(email, (load.get(email) || 0) + hrs);

    dealUpdates.push({ id: d.id, properties: { zia_talent_email: email } });
    assoc.push({
      from: { id: d.id }, to: { id: chosen.id },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.DEAL_TO_CONTACT }],
    });
  }

  const loads = [...load.values()].filter(h => h > 0).sort((a, b) => b - a);
  const busy = loads.length;
  const totalHours = loads.reduce((a, b) => a + b, 0);
  console.log(`\nreassigned               : ${dealUpdates.length}`);
  console.log(`left unassigned (no room): ${unplaced}`);
  console.log(`\nprojected staffing:`);
  console.log(`  consultants with work  : ${busy}`);
  console.log(`  total contracted hrs/wk: ${totalHours.toLocaleString()}`);
  console.log(`  avg per working person : ${(totalHours / busy).toFixed(1)} hrs/week`);
  console.log(`  busiest                : ${loads.slice(0, 5).join(', ')} hrs/week`);
  console.log(`  anyone over ${MAX_HOURS} hrs      : ${loads.filter(h => h > MAX_HOURS).length}`);

  if (!APPLY) { console.log('\ndry run — re-run with --apply.'); return; }

  const r = await batch('deals', 'update', dealUpdates);
  console.log(`\nupdated ${r.ok} engagements  failed ${r.failed}`);
  for (let i = 0; i < assoc.length; i += 100) {
    await api('POST', '/crm/v4/associations/deals/contacts/batch/create', { inputs: assoc.slice(i, i + 100) });
  }
  console.log(`associated ${assoc.length} engagements to their consultant`);
  console.log('\nRemember: node engine.js --only WF-12 && node snapshot.js && node build-dashboard.js');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
