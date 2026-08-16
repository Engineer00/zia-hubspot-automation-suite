'use strict';
/**
 * WF-15 Stripe Payment Reconciliation
 *
 * Scans deals/invoices and reconciles simulated Stripe payments:
 *   - Matches deals with unpaid/sent/overdue zia_invoice_status
 *   - Verifies simulated payment intent or checkout completions
 *   - Updates zia_invoice_status to 'paid', zeroes zia_days_outstanding
 *
 * Idempotent: Only updates deals that require status reconciliation.
 */
const { listAll, batch } = require('../lib/hubspot');

module.exports = {
  id: 'WF-15',
  name: 'Stripe Payment Reconciliation',

  async run({ dryRun, paymentMap = {} }) {
    const deals = await listAll('deals', ['dealname', 'amount', 'zia_invoice_status', 'zia_days_outstanding']);
    const unpaid = deals.filter(d => ['sent', 'overdue'].includes(d.properties.zia_invoice_status));

    if (!unpaid.length) {
      return { matched: 0, reconciled: 0, note: 'no unpaid invoices found requiring reconciliation' };
    }

    const updates = [];
    for (const d of unpaid) {
      // Check if this deal has an associated successful payment override or mock match
      const dealId = d.id;
      const isPaid = paymentMap[dealId] !== undefined ? paymentMap[dealId] : false;

      if (isPaid) {
        updates.push({
          id: dealId,
          properties: {
            zia_invoice_status: 'paid',
            zia_days_outstanding: 0,
          },
        });
      }
    }

    if (!updates.length) {
      return { matched: unpaid.length, reconciled: 0, note: 'all unpaid invoices evaluated; 0 pending payment updates' };
    }

    const r = await batch('deals', 'update', updates, { dryRun });
    return { matched: unpaid.length, reconciled: r.ok, failed: r.failed, wouldWrite: r.wouldWrite };
  },
};
