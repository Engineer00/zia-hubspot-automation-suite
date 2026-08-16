'use strict';
/**
 * P8 — the billing layer.
 *
 * HubSpot Commerce Hub cannot process payments without a US entity or a Stripe
 * merchant account, so we do not pretend to. Instead we model the integration
 * boundary the way a real consulting firm runs it:
 *
 *   CRM              owns the relationship and the contract value
 *   Accounting (QBO) owns the ledger
 *   The CRM carries a *mirror* of invoice state, synced back, so RevOps can
 *   report on collections without leaving HubSpot.
 *
 * These properties are exactly what a QuickBooks Online / Xero integration writes
 * back onto a deal. Populating them demonstrates the data contract without needing
 * the accounting system to exist.
 */
const { api, listAll, batch, STAGE } = require('../lib/hubspot');
const { rng, weighted, int, isoDate, DAY, clamp } = require('./lib');

const TODAY = new Date('2026-08-15').getTime();
const opt = (label, value, i) => ({ label, value, displayOrder: i, hidden: false });

const PROPS = [
  { name: 'zia_invoice_number', label: 'Invoice Number', type: 'string', fieldType: 'text',
    groupName: 'dealinformation', description: 'Mirrored from the accounting system. Format INV-YYYY-NNNNN.' },
  { name: 'zia_invoice_status', label: 'Invoice Status', type: 'enumeration', fieldType: 'select',
    groupName: 'dealinformation', description: 'Synced back from accounting. CRM is not the system of record for this field.',
    options: [['Draft','draft'],['Sent','sent'],['Paid','paid'],['Overdue','overdue'],['Written Off','written_off']].map(([l,v],i)=>opt(l,v,i)) },
  { name: 'zia_invoice_sent_date', label: 'Invoice Sent Date', type: 'date', fieldType: 'date', groupName: 'dealinformation' },
  { name: 'zia_invoice_due_date', label: 'Invoice Due Date', type: 'date', fieldType: 'date', groupName: 'dealinformation' },
  { name: 'zia_invoice_paid_date', label: 'Invoice Paid Date', type: 'date', fieldType: 'date', groupName: 'dealinformation' },
  { name: 'zia_payment_terms', label: 'Payment Terms', type: 'enumeration', fieldType: 'select',
    groupName: 'dealinformation',
    options: [['Net 15','net_15'],['Net 30','net_30'],['Net 45','net_45'],['Net 60','net_60']].map(([l,v],i)=>opt(l,v,i)) },
  { name: 'zia_days_outstanding', label: 'Days Outstanding', type: 'number', fieldType: 'number',
    groupName: 'dealinformation', description: 'Days since the invoice was due. Recomputed by the sync job; 0 once paid.' },
];

const TERM_DAYS = { net_15: 15, net_30: 30, net_45: 45, net_60: 60 };

module.exports = async function p8({ dryRun }) {
  /* ---------- 1. properties ---------- */
  const live = await api('GET', '/crm/v3/properties/deals');
  const have = new Set(live.results.map(p => p.name));
  for (const p of PROPS) {
    if (have.has(p.name)) { console.log(`  SKIP   ${p.name}`); continue; }
    if (dryRun) { console.log(`  WOULD CREATE ${p.name}`); continue; }
    try { const r = await api('POST', '/crm/v3/properties/deals', p); console.log(`  CREATE ${r.name} "${r.label}"`); }
    catch (e) { console.log(`  FAIL   ${p.name}: ${e.message.slice(0, 200)}`); }
  }

  /* ---------- 2. backfill onto won deals ---------- */
  const deals = await listAll('deals', ['dealname', 'dealstage', 'closedate', 'amount', 'zia_deal_type', 'zia_invoice_status']);
  const won = deals.filter(d => d.properties.zia_deal_type && d.properties.dealstage === STAGE.WON);
  console.log(`\n  won deals to invoice: ${won.length}`);

  // number sequentially by close date so invoice numbers ascend with time
  const ordered = [...won].sort((a, b) => (a.properties.closedate || '').localeCompare(b.properties.closedate || ''));

  const updates = [];
  const dist = {}, aging = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  let outstandingValue = 0, collectedValue = 0, seq = 0;

  for (const d of ordered) {
    const r = rng('inv:' + d.id);
    const amount = +d.properties.amount || 0;
    const close = d.properties.closedate ? new Date(d.properties.closedate).getTime() : TODAY;

    const terms = weighted(r, [['net_30', 58], ['net_15', 18], ['net_45', 16], ['net_60', 8]]);
    const sent = close + int(r, 0, 5) * DAY;
    const due = sent + TERM_DAYS[terms] * DAY;

    // an invoice raised in the future has not been sent yet
    let status;
    if (sent > TODAY) status = 'draft';
    else {
      status = weighted(r, [['paid', 78], ['sent', 11], ['overdue', 8], ['written_off', 3]]);
      if (status === 'sent' && due < TODAY) status = 'overdue';       // past due cannot still be "sent"
      if (status === 'overdue' && due > TODAY) status = 'sent';        // not yet due cannot be overdue
    }

    const props = {
      zia_invoice_number: `INV-${new Date(sent).getUTCFullYear()}-${String(++seq).padStart(5, '0')}`,
      zia_invoice_status: status,
      zia_payment_terms: terms,
    };

    if (status !== 'draft') {
      props.zia_invoice_sent_date = isoDate(sent);
      props.zia_invoice_due_date = isoDate(due);
    }

    if (status === 'paid') {
      // most pay near terms, a tail pays late
      const payLag = r() < 0.72 ? int(r, -6, 8) : int(r, 9, 44);
      const paid = clamp(due + payLag * DAY, sent, TODAY);
      props.zia_invoice_paid_date = isoDate(paid);
      props.zia_days_outstanding = '0';
      collectedValue += amount;
      aging.current++;
    } else if (status === 'overdue' || status === 'written_off') {
      const daysOut = Math.max(1, Math.round((TODAY - due) / DAY));
      props.zia_days_outstanding = String(daysOut);
      outstandingValue += amount;
      if (daysOut <= 30) aging['1-30']++;
      else if (daysOut <= 60) aging['31-60']++;
      else if (daysOut <= 90) aging['61-90']++;
      else aging['90+']++;
    } else if (status === 'sent') {
      props.zia_days_outstanding = '0';
      outstandingValue += amount;
      aging.current++;
    }

    dist[status] = (dist[status] || 0) + 1;
    updates.push({ id: d.id, properties: props });
  }

  console.log(`  status distribution: ${JSON.stringify(dist)}`);
  console.log(`  aging buckets      : ${JSON.stringify(aging)}`);
  console.log(`  collected          : $${collectedValue.toLocaleString()}`);
  console.log(`  outstanding        : $${outstandingValue.toLocaleString()}`);

  const res = await batch('deals', 'update', updates, { dryRun });
  return { invoiced: res.ok, failed: res.failed, wouldWrite: res.wouldWrite, dist, aging, collectedValue, outstandingValue };
};
