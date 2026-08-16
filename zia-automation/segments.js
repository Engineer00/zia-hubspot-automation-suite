#!/usr/bin/env node
'use strict';
/**
 * Lists / segments — the capability this build had wrongly recorded as tier-gated.
 *
 * The 403 was `crm.lists.read`, a scope. HubSpot ships lists on every plan including
 * free. Once the scope was enabled this became buildable, and it matters: a segment
 * is the UI surface for the same conditions the automation rules reconcile. The rule
 * does the work; the segment is where a human goes to see the queue.
 *
 * Every segment below mirrors a rule or a finding, so the portal has a worklist for
 * each thing the engine acts on.
 *
 * Idempotent: existing lists are matched by name and skipped.
 *
 *   node segments.js --dry-run
 *   node segments.js
 */
const { api } = require('./lib/hubspot');

const OBJ = { contacts: '0-1', companies: '0-2', deals: '0-3', tickets: '0-5' };

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');

/** filterBranch helpers — HubSpot's shape is verbose, so build it from parts. */
const enumIs = (property, values) => ({
  filterType: 'PROPERTY', property,
  operation: { operationType: 'ENUMERATION', operator: 'IS_ANY_OF', values, includeObjectsWithNoValueSet: false },
});
const enumNot = (property, values) => ({
  filterType: 'PROPERTY', property,
  operation: { operationType: 'ENUMERATION', operator: 'IS_NONE_OF', values, includeObjectsWithNoValueSet: false },
});
const known = property => ({
  filterType: 'PROPERTY', property,
  operation: { operationType: 'ALL_PROPERTY', operator: 'IS_KNOWN', includeObjectsWithNoValueSet: false },
});
const unknown = property => ({
  filterType: 'PROPERTY', property,
  operation: { operationType: 'ALL_PROPERTY', operator: 'IS_UNKNOWN', includeObjectsWithNoValueSet: true },
});
const numLt = (property, value) => ({
  filterType: 'PROPERTY', property,
  operation: { operationType: 'NUMBER', operator: 'IS_LESS_THAN', value, includeObjectsWithNoValueSet: false },
});
const numGt = (property, value) => ({
  filterType: 'PROPERTY', property,
  operation: { operationType: 'NUMBER', operator: 'IS_GREATER_THAN', value, includeObjectsWithNoValueSet: false },
});

/** Wrap a flat AND of filters into the branch envelope the API expects. */
const AND = filters => ({
  filterBranchType: 'OR',
  filterBranches: [{ filterBranchType: 'AND', filters, filterBranches: [] }],
  filters: [],
});

// ---------------------------------------------------------------------------
// The segments. Each one is a worklist a real operator would open.
// ---------------------------------------------------------------------------

const SEGMENTS = [
  {
    name: 'Consultants · placeable now',
    object: 'contacts',
    why: 'Bench-ready and compliance-clear. This is sellable capacity — the list sales should be looking at before promising a start date.',
    branch: AND([
      enumIs('zia_contact_type', ['talent']),
      enumIs('zia_bench_status', ['bench_ready']),
      enumIs('zia_compliance_status', ['clear']),
    ]),
  },
  {
    name: 'Consultants · blocked by compliance',
    object: 'contacts',
    why: 'Capacity locked behind paperwork. Mirrors WF-06, which holds these off the bench automatically.',
    branch: AND([
      enumIs('zia_contact_type', ['talent']),
      enumIs('zia_compliance_status', ['lapsed', 'not_started', 'expiring_soon']),
    ]),
  },
  {
    name: 'Client buyers · no deal yet',
    object: 'contacts',
    why: 'The prospect pool — 525 contacts whose companies have never had a deal. Names the gap rather than hiding it.',
    branch: AND([
      enumIs('zia_contact_type', ['client_contact']),
      enumIs('hs_lead_status', ['NEW']),
    ]),
  },
  {
    name: 'Client buyers · live opportunity',
    object: 'contacts',
    why: 'Contacts at companies with an open deal. Set by WF-02, which rolls the strongest deal outcome onto the contact.',
    branch: AND([
      enumIs('zia_contact_type', ['client_contact']),
      enumIs('hs_lead_status', ['OPEN_DEAL', 'IN_PROGRESS']),
    ]),
  },
  {
    name: 'Placements · flagged at risk',
    object: 'deals',
    why: 'What the CRM currently admits is at risk: 22 engagements.',
    branch: AND([enumIs('zia_placement_status', ['at_risk'])]),
  },
  {
    name: 'Placements · scoring below 60',
    object: 'deals',
    why: 'THE FINDING. 144 engagements score under the 60 threshold but only 22 carry the At Risk status. Health is measured and never governs the status field — this segment is the 6x gap made visible.',
    branch: AND([known('zia_placement_status'), numLt('zia_health_score', 60)]),
  },
  {
    name: 'Acquisition · open pipeline',
    object: 'deals',
    why: 'New business only. The Placement Status filter is what stops delivery engagements being counted as sales — the same filter every revenue report needs.',
    branch: AND([unknown('zia_placement_status'), enumIs('dealstage', ['4119724776', '4119724777', '4119724778', '4119724779'])]),
  },
  {
    name: 'Invoices · 90+ days overdue',
    object: 'deals',
    why: 'The collections tail: 86 of 115 unpaid invoices sit here. Mirrors WF-07, which raises a ticket per past-due invoice.',
    branch: AND([enumIs('zia_invoice_status', ['overdue']), numGt('zia_days_outstanding', 90)]),
  },
  {
    name: 'Clients · at-risk accounts',
    object: 'companies',
    why: 'Account-level health, so a client with several struggling engagements surfaces as one relationship problem rather than three separate tickets.',
    branch: AND([enumIs('zia_client_health', ['at_risk'])]),
  },
];

// ---------------------------------------------------------------------------

(async () => {
  console.log(`${SEGMENTS.length} segments defined\n`);

  // existing, by name — makes re-runs no-ops
  const existing = new Map();
  let after = 0;
  for (;;) {
    const r = await api('POST', '/crm/v3/lists/search', { count: 100, offset: after });
    for (const l of r.lists || []) existing.set(l.name, l.listId);
    if (!r.hasMore) break;
    after = r.offset + (r.lists || []).length;
  }
  console.log(`existing lists in portal: ${existing.size}\n`);

  const results = [];
  for (const seg of SEGMENTS) {
    if (existing.has(seg.name)) {
      console.log(`  skip    ${seg.name}  (exists, id ${existing.get(seg.name)})`);
      results.push({ name: seg.name, status: 'exists', id: existing.get(seg.name) });
      continue;
    }
    if (DRY) {
      console.log(`  would   ${seg.name}  [${seg.object}]`);
      results.push({ name: seg.name, status: 'would-create' });
      continue;
    }
    try {
      const r = await api('POST', '/crm/v3/lists', {
        name: seg.name,
        objectTypeId: OBJ[seg.object],
        processingType: 'DYNAMIC',          // active list — re-evaluates membership
        filterBranch: seg.branch,
      });
      const id = r.list.listId;
      console.log(`  created ${seg.name}  [${seg.object}] id ${id}`);
      results.push({ name: seg.name, status: 'created', id });
    } catch (e) {
      const msg = String(e.message).slice(0, 220).replace(/\n/g, ' ');
      console.log(`  FAILED  ${seg.name}  -> ${e.status} ${msg}`);
      results.push({ name: seg.name, status: 'failed', error: msg });
    }
  }

  const tally = results.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
  console.log(`\n${JSON.stringify(tally)}`);

  // membership counts, so the segments can be cited like every other number here
  if (!DRY) {
    console.log('\nmembership:');
    for (const r of results.filter(x => x.id)) {
      try {
        const m = await api('GET', `/crm/v3/lists/${r.id}`);
        console.log(`  ${String(m.list.additionalProperties?.hs_list_size ?? '—').padStart(6)}  ${r.name}`);
      } catch { /* size is computed asynchronously; not fatal */ }
    }
    console.log('\nNote: HubSpot computes dynamic list membership asynchronously.');
    console.log('Sizes may read 0 for a minute or two after creation.');
  }
})();
