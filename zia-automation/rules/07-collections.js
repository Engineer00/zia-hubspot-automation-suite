'use strict';
/**
 * WF-07  Collections
 *
 * The sync job an accounting integration would drive. In production the invoice
 * state originates in QuickBooks/Xero and is written back onto the deal; here the
 * rule maintains the derived fields and raises the work item.
 *
 * Trigger : an invoice past its due date that is not paid
 * Actions : set status to Overdue, recompute Days Outstanding, and open one
 *           collections ticket per account — priority scaled by how far past due
 * Idempotent: deals already Overdue with a correct day count are left alone, and
 *             tickets are deduped against open collections tickets.
 */
const { api, searchAll, batch, readAssociations, associatedIdSet, ASSOC, TICKET_STAGE, OWNER_ID, TICKET_PIPELINE } = require('../lib/hubspot');

const DAY = 864e5;

module.exports = {
  id: 'WF-07',
  name: 'Collections',

  async run({ dryRun }) {
    const today = Date.now();

    const unpaid = await searchAll('deals', {
      properties: ['dealname', 'amount', 'zia_invoice_number', 'zia_invoice_status', 'zia_invoice_due_date', 'zia_days_outstanding'],
      filterGroups: [
        { filters: [{ propertyName: 'zia_invoice_status', operator: 'EQ', value: 'sent' }] },
        { filters: [{ propertyName: 'zia_invoice_status', operator: 'EQ', value: 'overdue' }] },
      ],
    });
    console.log(`    unpaid invoices in scope: ${unpaid.length}`);

    // 1. reconcile status + days outstanding
    const updates = [];
    let nowOverdue = 0;
    const pastDue = [];
    for (const d of unpaid) {
      const due = d.properties.zia_invoice_due_date ? new Date(d.properties.zia_invoice_due_date).getTime() : null;
      if (!due) continue;
      const overdue = due < today;
      // floor, not round. Due dates sit at midnight, so every invoice shares the same
      // fractional day — Math.round flipped all 108 at once at 12:00 UTC and again at
      // date rollover, rewriting the whole set twice a day for no semantic reason.
      // A day is not "outstanding" until it has fully elapsed.
      const days = overdue ? Math.max(1, Math.floor((today - due) / DAY)) : 0;
      const status = overdue ? 'overdue' : 'sent';

      if (overdue) { pastDue.push({ deal: d, days }); if (d.properties.zia_invoice_status !== 'overdue') nowOverdue++; }

      if (d.properties.zia_invoice_status !== status || String(days) !== d.properties.zia_days_outstanding) {
        updates.push({ id: d.id, properties: { zia_invoice_status: status, zia_days_outstanding: String(days) } });
      }
    }
    const uRes = await batch('deals', 'update', updates, { dryRun });

    // 2. one collections ticket per past-due invoice, deduped
    const openCollections = await searchAll('tickets', {
      properties: ['zia_ticket_type', 'hs_pipeline_stage'],
      filterGroups: [{ filters: [
        { propertyName: 'zia_ticket_type', operator: 'EQ', value: 'collections' },
        { propertyName: 'hs_pipeline_stage', operator: 'NEQ', value: TICKET_STAGE.CLOSED },
      ] }],
    });
    const covered = await associatedIdSet('tickets', 'deals', openCollections.map(t => t.id));

    const needs = pastDue.filter(p => !covered.has(p.deal.id));
    let created = 0, failed = 0, wouldWrite;

    if (needs.length) {
      const assocCo = await readAssociations('deals', 'companies', needs.map(p => p.deal.id));
      const inputs = needs.map(({ deal, days }) => {
        const assoc = [{ to: { id: deal.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.TICKET_TO_DEAL }] }];
        const co = (assocCo.get(deal.id) || [])[0];
        if (co) assoc.push({ to: { id: co }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC.TICKET_TO_COMPANY }] });

        const priority = days > 90 ? 'HIGH' : days > 30 ? 'MEDIUM' : 'LOW';
        return {
          properties: {
            subject: `Collections — ${deal.properties.zia_invoice_number} · ${days}d overdue`,
            content: `Invoice ${deal.properties.zia_invoice_number} for $${(+deal.properties.amount || 0).toLocaleString()} is ${days} days past due. `
                   + (days > 90 ? 'Beyond 90 days — escalate to finance and consider write-off.' : 'Chase the account contact for payment status.'),
            hs_pipeline: TICKET_PIPELINE,
            hs_pipeline_stage: days > 90 ? TICKET_STAGE.WAITING_US : TICKET_STAGE.WAITING_CONTACT,
            hs_ticket_priority: priority,
            hubspot_owner_id: OWNER_ID,
            zia_ticket_type: 'collections',
            zia_sla_breached: String(days > 90),
          },
          associations: assoc,
        };
      });
      const r = await batch('tickets', 'create', inputs, { dryRun });
      created = r.ok; failed = r.failed; wouldWrite = r.wouldWrite;
    }

    const totalOutstanding = pastDue.reduce((s, p) => s + (+p.deal.properties.amount || 0), 0);
    return {
      unpaid: unpaid.length,
      pastDue: pastDue.length,
      newlyOverdue: nowOverdue,
      reconciled: uRes.ok,
      ticketsCreated: created,
      outstandingValue: `$${totalOutstanding.toLocaleString()}`,
      failed: uRes.failed + failed,
      wouldWrite: (uRes.wouldWrite || 0) + (wouldWrite || 0),
    };
  },
};
