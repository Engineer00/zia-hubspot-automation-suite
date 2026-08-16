'use strict';
/**
 * P1 — a coherent timeline.
 *
 * Everything currently reads "Created: today". Rather than scattering random dates,
 * derive them backwards from data that already exists, so the timeline is
 * self-consistent under scrutiny:
 *
 *   deal.createdate    = closedate - sales cycle        (log-normal, median ~55d)
 *   company.createdate = earliest related deal - 10..90d
 *   contact.createdate = its company + 0..30d
 *   ticket.createdate  = related deal closedate + 0..7d
 *
 * A deal therefore never predates its company, and a ticket never predates the
 * deal that produced it — which is the thing an interviewer actually spot-checks.
 */
const { listAll, batch, readAssociations } = require('../lib/hubspot');
const { rng, logNormal, int, clamp, DAY, iso, businessTime } = require('./lib');

const NOW = new Date('2026-08-15T12:00:00Z').getTime();
const FLOOR = new Date('2024-01-10T00:00:00Z').getTime();

module.exports = async function p1({ dryRun }) {
  // ---------- deals ----------
  const deals = await listAll('deals', ['dealname', 'closedate', 'createdate', 'zia_deal_type', 'zia_placement_status', 'zia_embed_start_date']);
  const seeded = deals.filter(d => d.properties.zia_deal_type);
  console.log(`  deals: ${seeded.length}`);

  const dealCreate = new Map();
  const dealUpdates = [];
  for (const d of seeded) {
    const r = rng('t:' + d.id);
    const close = d.properties.closedate ? new Date(d.properties.closedate).getTime() : NOW;
    // placements are created when the embed starts; acquisitions run a sales cycle
    const cycleDays = d.properties.zia_placement_status
      ? clamp(logNormal(r, 12, 0.5), 3, 45)
      : clamp(logNormal(r, 55, 0.62), 12, 240);
    let created = close - cycleDays * DAY;
    created = clamp(created, FLOOR, NOW - DAY);
    const ts = businessTime(r, created).getTime();
    dealCreate.set(d.id, ts);
    dealUpdates.push({ id: d.id, properties: { createdate: iso(ts) } });
  }
  const dRes = await batch('deals', 'update', dealUpdates, { dryRun });
  console.log(`  deal createdate set: ${dRes.ok || dRes.wouldWrite || 0}`);

  // ---------- companies: earliest related deal ----------
  const dealCompanies = await readAssociations('deals', 'companies', seeded.map(d => d.id));
  const earliestByCompany = new Map();
  for (const d of seeded) {
    const ts = dealCreate.get(d.id);
    for (const co of dealCompanies.get(d.id) || []) {
      if (!earliestByCompany.has(co) || ts < earliestByCompany.get(co)) earliestByCompany.set(co, ts);
    }
  }

  const companies = await listAll('companies', ['name', 'domain', 'createdate']);
  const seededCo = companies.filter(c => c.properties.domain !== 'hubspot.com');
  const companyCreate = new Map();
  const coUpdates = [];
  for (const c of seededCo) {
    const r = rng('t:' + c.id);
    const anchor = earliestByCompany.get(c.id);
    // a prospect with no deal still has to have entered the CRM at some point
    let created = anchor ? anchor - int(r, 10, 90) * DAY
                         : NOW - int(r, 30, 760) * DAY;
    created = clamp(created, FLOOR, NOW - DAY);
    const ts = businessTime(r, created).getTime();
    companyCreate.set(c.id, ts);
    coUpdates.push({ id: c.id, properties: { createdate: iso(ts) } });
  }
  const cRes = await batch('companies', 'update', coUpdates, { dryRun });
  console.log(`  company createdate set: ${cRes.ok || cRes.wouldWrite || 0}`);

  // ---------- contacts: their company + 0..30d ----------
  const contacts = await listAll('contacts', ['email', 'zia_contact_type', 'createdate']);
  const seededCt = contacts.filter(c => c.properties.zia_contact_type);
  const contactCompany = await readAssociations('contacts', 'companies', seededCt.map(c => c.id));

  const contactCreate = new Map();
  const ctUpdates = [];
  for (const c of seededCt) {
    const r = rng('t:' + c.id);
    const co = (contactCompany.get(c.id) || [])[0];
    const anchor = co && companyCreate.get(co);
    let created = anchor ? anchor + int(r, 0, 30) * DAY : NOW - int(r, 30, 700) * DAY;
    created = clamp(created, FLOOR, NOW - DAY);
    const ts = businessTime(r, created).getTime();
    contactCreate.set(c.id, ts);
    ctUpdates.push({ id: c.id, properties: { createdate: iso(ts) } });
  }
  const ctRes = await batch('contacts', 'update', ctUpdates, { dryRun });
  console.log(`  contact createdate set: ${ctRes.ok || ctRes.wouldWrite || 0}`);

  // ---------- tickets: related deal close + 0..7d ----------
  const tickets = await listAll('tickets', ['subject', 'zia_ticket_type', 'createdate']);
  const ticketDeals = await readAssociations('tickets', 'deals', tickets.map(t => t.id));
  const closeById = new Map(seeded.map(d => [d.id, d.properties.closedate ? new Date(d.properties.closedate).getTime() : null]));

  const tkUpdates = [];
  for (const t of tickets) {
    const r = rng('t:' + t.id);
    const dealId = (ticketDeals.get(t.id) || [])[0];
    const close = dealId && closeById.get(dealId);
    let created = close ? close + int(r, 0, 7) * DAY : NOW - int(r, 1, 400) * DAY;
    created = clamp(created, FLOOR, NOW - 3600e3);
    tkUpdates.push({ id: t.id, properties: { createdate: iso(businessTime(r, created).getTime()) } });
  }
  const tkRes = await batch('tickets', 'update', tkUpdates, { dryRun });
  console.log(`  ticket createdate set: ${tkRes.ok || tkRes.wouldWrite || 0}`);

  // export anchors for the engagement phase
  require('fs').writeFileSync(__dirname + '/timeline.json', JSON.stringify({
    deals: [...dealCreate], companies: [...companyCreate], contacts: [...contactCreate],
  }));

  return {
    deals: dRes.ok, companies: cRes.ok, contacts: ctRes.ok, tickets: tkRes.ok,
    failed: dRes.failed + cRes.failed + ctRes.failed + tkRes.failed,
    wouldWrite: (dRes.wouldWrite||0)+(cRes.wouldWrite||0)+(ctRes.wouldWrite||0)+(tkRes.wouldWrite||0),
  };
};
