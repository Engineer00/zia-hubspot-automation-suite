'use strict';
/**
 * P9 — quotes.
 *
 * A consulting firm sends a proposal before it wins work, so the sales motion is
 * incomplete without quotes. Quotes ARE available on this tier — the earlier 400
 * was a missing `crm.objects.quotes.*` scope, not a tier block.
 *
 * A quote is only raised once a deal reaches proposal stage, so we create them for
 * deals at Proposal Sent or beyond — including the ones that later closed, won or
 * lost, because a lost deal that got a proposal still had one.
 *
 * The quote is wired to the deal, its buyer company, its contact, AND the deal's
 * line items — that last link is what makes HubSpot compute the quote amount
 * instead of showing zero.
 *
 * `hs_status` is rejected at create time (HubSpot derives it), so it is left alone.
 */
const { api, listAll, batch, readAssociations, STAGE } = require('../lib/hubspot');
const { rng, isoDate, int, DAY } = require('./lib');

const A = { deal: 64, company: 71, contact: 69, lineItem: 67 };
const HD = id => [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: id }];

const PROPOSAL_PLUS = [STAGE.PROPOSAL, STAGE.NEGOTIATION, STAGE.WON, STAGE.LOST];

module.exports = async function p9({ dryRun }) {
  const deals = await listAll('deals', ['dealname', 'dealstage', 'closedate', 'amount', 'zia_deal_type', 'zia_placement_status']);
  const acq = deals.filter(d => d.properties.zia_deal_type && !d.properties.zia_placement_status);

  // only deals that actually reached a proposal
  const candidates = acq.filter(d => PROPOSAL_PLUS.includes(d.properties.dealstage));
  const scoped = candidates.filter(d => {
    if (d.properties.dealstage !== STAGE.LOST) return true;
    // not every lost deal got as far as a proposal
    return rng('quote:' + d.id)() < 0.42;
  });
  console.log(`  acquisition deals: ${acq.length}`);
  console.log(`  reached proposal : ${candidates.length}`);
  console.log(`  quotes to create : ${scoped.length}`);

  const ids = scoped.map(d => d.id);
  const dCo = await readAssociations('deals', 'companies', ids);
  const dCt = await readAssociations('deals', 'contacts', ids);
  const dLi = await readAssociations('deals', 'line_items', ids);

  const byStage = {};
  const inputs = scoped.map(d => {
    const r = rng('quote:' + d.id);
    const stage = d.properties.dealstage;
    byStage[stage] = (byStage[stage] || 0) + 1;

    const close = d.properties.closedate ? new Date(d.properties.closedate).getTime() : Date.now();
    // proposals go out ahead of the close and expire a month later
    const sent = close - int(r, 10, 45) * DAY;
    const expires = sent + int(r, 21, 45) * DAY;

    const assoc = [{ to: { id: d.id }, types: HD(A.deal) }];
    const co = (dCo.get(d.id) || [])[0];
    const ct = (dCt.get(d.id) || [])[0];
    if (co) assoc.push({ to: { id: co }, types: HD(A.company) });
    if (ct) assoc.push({ to: { id: ct }, types: HD(A.contact) });
    for (const li of dLi.get(d.id) || []) assoc.push({ to: { id: li }, types: HD(A.lineItem) });

    return {
      properties: {
        hs_title: `${d.properties.dealname} — proposal`,
        hs_expiration_date: isoDate(expires),
      },
      associations: assoc,
    };
  });

  console.log(`  by stage: ${JSON.stringify(byStage)}`);
  const res = await batch('quotes', 'create', inputs, { dryRun, concurrency: 3 });
  console.log(`  created: ${res.ok || res.wouldWrite || 0}   failed: ${res.failed}`);

  return { created: res.ok, failed: res.failed, wouldWrite: res.wouldWrite, byStage };
};
