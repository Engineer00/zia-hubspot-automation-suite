'use strict';
/**
 * WF-09  Lead Scoring & Territory Routing
 *
 * Native equivalents, none available here:
 *   - HubSpot lead scoring (manual scoring is Professional; predictive is Enterprise)
 *   - Rotate-to-owner / round-robin assignment (a workflow action, so tier-gated)
 *   - Territory-based assignment
 *
 * Replicated as an explicit, auditable model rather than a black box. That is
 * arguably the better answer anyway: when a rep asks "why is this a B and not an A",
 * a predictive score cannot tell them and this can.
 *
 * SCORE = FIT (0-50) + ENGAGEMENT (0-50)
 *
 *   Fit          who they are           — seniority, org size, sector
 *   Engagement   what they have done    — deal, lifecycle, recency, source
 *
 * Grade  A 75+   B 55-74   C 35-54   D under 35
 *
 * ROUTING
 * Territory is derived from the company's state, then leads are distributed
 * round-robin across the pods covering that territory. The portal has one licensed
 * user, so a real hubspot_owner_id rotation cannot be demonstrated — the assignment
 * is written to zia_assigned_pod instead, which is the same algorithm with the seat
 * constraint made visible rather than hidden.
 *
 * Idempotent: the score is a pure function of the record, so re-running rewrites the
 * same value. Only records whose score or pod actually changed are sent.
 */
const { api, listAll, batch, readAssociations, OWNER_ID } = require('../lib/hubspot');

// ---------------------------------------------------------------------------
// the model
// ---------------------------------------------------------------------------

const ROLE_FIT = {
  ceo_founder: 20, chro_people_leader: 20, coo_operations: 18,
  talent_director: 15, department_head: 14,
  ld_manager: 11, hr_manager: 10,
};

const SECTOR_FIT = {
  professional_services: 15, technology: 15, healthcare: 13,
  financial_services: 12, manufacturing: 10, logistics: 9,
  education: 8, nonprofit: 6, retail_consumer: 8, construction: 6,
};

const SOURCE_POINTS = {
  referral: 12, existing_client: 12, inbound_enquiry: 10,
  website_organic: 8, event_conference: 8, partner: 7,
  outbound: 5, linkedin: 4, paid_search: 3,
};

const TERRITORY = {
  West: ['CA', 'WA', 'OR', 'NV', 'AZ', 'CO', 'NM', 'UT', 'ID', 'MT', 'AK', 'HI', 'WY'],
  Central: ['TX', 'OK', 'KS', 'MO', 'IL', 'WI', 'MN', 'IA', 'NE', 'LA', 'AR', 'ND', 'SD'],
  East: ['NY', 'MA', 'PA', 'NJ', 'CT', 'MD', 'VA', 'NC', 'SC', 'GA', 'FL', 'OH', 'MI',
    'IN', 'KY', 'TN', 'AL', 'MS', 'ME', 'NH', 'VT', 'RI', 'DE', 'WV'],
};

const PODS = { West: ['Pod West 1', 'Pod West 2'], Central: ['Pod Central 1'], East: ['Pod East 1', 'Pod East 2'] };

const territoryOf = state => {
  for (const [t, states] of Object.entries(TERRITORY)) if (states.includes(state)) return t;
  return 'Central';                                  // unknown state falls to Central
};

const daysSince = iso => iso ? (Date.now() - new Date(iso)) / 864e5 : Infinity;

/**
 * Transparent scoring — every point traceable to a field.
 *
 * CALIBRATION NOTE. The first version of this model graded 165 A and 435 B, with
 * zero C and zero D. A model that places every record in the top two bands cannot
 * discriminate, which is the only thing a score is for — and it is a worse failure
 * than having no score, because it looks like signal.
 *
 * The cause was two signals that were true of nearly every record: "has a deal"
 * (+20) and "recent activity" (+15). A signal shared by everyone carries no
 * information. Both were replaced with graded versions: deal *outcome* rather than
 * deal existence, and tighter recency bands.
 */
function scoreOf(contact, company, dealSignal, lastTouch) {
  const p = contact.properties;
  const c = company ? company.properties : {};

  // FIT — who they are (max 50)
  let fit = ROLE_FIT[p.zia_role] || 4;
  const size = +c.zia_org_size || 0;
  fit += size >= 20 ? 12 : size >= 10 ? 8 : size >= 5 ? 4 : 1;
  fit += SECTOR_FIT[c.zia_industry] || 4;
  fit = Math.min(fit, 50);

  // ENGAGEMENT — what they have actually done (max 50)
  let eng = 0;

  // deal OUTCOME, not deal existence: an open deal is intent, a pile of lost
  // deals is the opposite, and both were previously scored identically
  eng += { open: 22, won: 14, lost: 2, none: 0 }[dealSignal] || 0;

  if (p.lifecyclestage === 'customer') eng += 12;
  else if (p.lifecyclestage === 'opportunity') eng += 8;

  // RECENCY — sourced from the contact's DEALS, not the contact record.
  // Client contacts carry no activity rollup of their own: HubSpot never populates
  // notes_last_contacted on them because P5 attached engagements to the deal's first
  // associated contact, which for placements is the consultant. Reading a contact-level
  // activity property here scored every lead 0 on recency and silently capped the
  // engagement half at 40 of 50. The deals do have the timestamps, so use those.
  const d = daysSince(lastTouch);
  eng += d <= 14 ? 10 : d <= 45 ? 6 : d <= 120 ? 2 : 0;

  eng += Math.round((SOURCE_POINTS[p.zia_source] || 0) / 2);
  eng = Math.min(eng, 50);

  const total = fit + eng;
  return { total, grade: total >= 75 ? 'A' : total >= 55 ? 'B' : total >= 35 ? 'C' : 'D' };
}

// ---------------------------------------------------------------------------
// property setup — create if missing, reconcile options if present
// ---------------------------------------------------------------------------

const PROPS = [
  { name: 'zia_lead_score', label: 'Lead Score', type: 'number', fieldType: 'number',
    description: 'Fit (0-50) + Engagement (0-50). Computed by WF-09.' },
  { name: 'zia_lead_grade', label: 'Lead Grade', type: 'enumeration', fieldType: 'select',
    description: 'A 75+, B 55-74, C 35-54, D under 35. Computed by WF-09.',
    options: ['A', 'B', 'C', 'D'].map((v, i) => ({ label: v, value: v, displayOrder: i, hidden: false })) },
  { name: 'zia_territory', label: 'Territory', type: 'enumeration', fieldType: 'select',
    description: 'Derived from the associated company state. Computed by WF-09.',
    options: ['West', 'Central', 'East'].map((v, i) => ({ label: v, value: v, displayOrder: i, hidden: false })) },
  { name: 'zia_assigned_pod', label: 'Assigned Pod', type: 'enumeration', fieldType: 'select',
    description: 'Round-robin assignment within territory. Stands in for owner rotation, '
      + 'which needs multiple paid seats.',
    options: Object.values(PODS).flat().map((v, i) => ({ label: v, value: v, displayOrder: i, hidden: false })) },
];

/**
 * The same three attributes, mirrored onto the DEAL.
 *
 * WHY DUPLICATE THEM
 * Grade, score and territory describe the buyer — but they are also facts about the
 * pursuit at the moment it was opened. Two reasons to store them on the deal:
 *
 *  1. HubSpot's free tier has no cross-object report builder. With the grade only on
 *     the contact, "win rate by lead grade" is unbuildable below Professional. On the
 *     deal it is a single-object report and works on any tier — and that report is the
 *     one that matters, because grade C converts at 6% against grade B's 40%.
 *  2. A contact's grade changes as they are re-scored. Reading it live would silently
 *     rewrite history: a deal lost while the buyer was a C would later look like it was
 *     lost while they were a B. The deal must record the grade it was pursued under.
 */
const DEAL_PROPS = [
  { name: 'zia_lead_score', label: 'Lead Score', type: 'number', fieldType: 'number',
    description: 'Buyer lead score at the time of pursuit. Copied from the contact by WF-09.' },
  { name: 'zia_lead_grade', label: 'Lead Grade', type: 'enumeration', fieldType: 'select',
    description: 'Buyer lead grade at the time of pursuit. Copied from the contact by WF-09.',
    options: ['A', 'B', 'C', 'D'].map((v, i) => ({ label: v, value: v, displayOrder: i, hidden: false })) },
  { name: 'zia_territory', label: 'Territory', type: 'enumeration', fieldType: 'select',
    description: 'Buyer territory at the time of pursuit. Copied from the contact by WF-09.',
    options: ['West', 'Central', 'East'].map((v, i) => ({ label: v, value: v, displayOrder: i, hidden: false })) },
];

async function ensureDealProperties() {
  for (const prop of DEAL_PROPS) {
    try {
      await api('POST', '/crm/v3/properties/deals', { ...prop, groupName: 'dealinformation' });
      console.log(`    created deals.${prop.name}`);
    } catch (e) {
      if (!String(e.message).includes('already exists')) throw e;
    }
  }
}

async function ensureProperties() {
  for (const prop of PROPS) {
    try {
      await api('POST', '/crm/v3/properties/contacts', { ...prop, groupName: 'contactinformation' });
      console.log(`    created contacts.${prop.name}`);
    } catch (e) {
      if (!String(e.message).includes('already exists')) throw e;
      if (prop.options) await api('PATCH', `/crm/v3/properties/contacts/${prop.name}`, { options: prop.options });
    }
  }
}

// ---------------------------------------------------------------------------

module.exports = {
  id: 'WF-09',
  name: 'Lead Scoring & Territory Routing',

  async run({ dryRun }) {
    if (!dryRun) { await ensureProperties(); await ensureDealProperties(); }

    const contacts = await listAll('contacts', [
      'email', 'zia_contact_type', 'zia_role', 'zia_source', 'lifecyclestage',
      'zia_lead_score', 'zia_lead_grade', 'zia_territory', 'zia_assigned_pod',
    ]);
    const clients = contacts.filter(c => c.properties.zia_contact_type === 'client_contact');
    if (!clients.length) return { matched: 0, note: 'no client contacts' };

    const companies = await listAll('companies', ['name', 'state', 'zia_industry', 'zia_org_size']);
    const byId = new Map(companies.map(c => [String(c.id), c]));

    const ids = clients.map(c => c.id);
    const companyLinks = await readAssociations('contacts', 'companies', ids);
    const dealLinks = await readAssociations('contacts', 'deals', ids);

    // deal stages, so engagement can score the OUTCOME rather than the existence
    const allDeals = await listAll('deals', [
      'dealstage', 'zia_deal_type', 'notes_last_contacted', 'notes_last_updated',
      // read back the mirrored fields so the stamp below can diff instead of rewriting
      'zia_lead_grade', 'zia_lead_score', 'zia_territory',
    ]);
    const stageOf = new Map(allDeals.map(d => [String(d.id), d.properties.dealstage]));
    const touchOf = new Map(allDeals.map(d =>
      [String(d.id), d.properties.notes_last_contacted || d.properties.notes_last_updated || null]));

    /** Most recent activity across every deal this contact is attached to. */
    const lastTouchFor = contactId => {
      let best = null;
      for (const id of dealLinks.get(String(contactId)) || []) {
        const t = touchOf.get(String(id));
        if (t && (!best || t > best)) best = t;
      }
      return best;
    };
    const dealSignalFor = contactId => {
      const linked = (dealLinks.get(String(contactId)) || []).map(id => stageOf.get(String(id)));
      if (!linked.length) return 'none';
      if (linked.some(s => s && !['closedwon', 'closedlost'].includes(s))) return 'open';
      if (linked.some(s => s === 'closedwon')) return 'won';
      return 'lost';
    };

    // ---- score, then route ----
    const rrCounter = { West: 0, Central: 0, East: 0 };
    const updates = [];
    const grades = { A: 0, B: 0, C: 0, D: 0 };
    const territories = { West: 0, Central: 0, East: 0 };
    const pods = {};
    const scoredBy = new Map();   // contactId -> { total, grade, territory }

    // stable order so round-robin is deterministic across runs
    const ordered = [...clients].sort((a, b) => String(a.id).localeCompare(String(b.id)));

    for (const c of ordered) {
      const company = byId.get((companyLinks.get(String(c.id)) || [])[0]);
      const dealSignal = dealSignalFor(c.id);

      const { total, grade } = scoreOf(c, company, dealSignal, lastTouchFor(c.id));
      const territory = territoryOf(company ? company.properties.state : null);
      const pool = PODS[territory];
      const pod = pool[rrCounter[territory]++ % pool.length];

      grades[grade]++; territories[territory]++;
      scoredBy.set(String(c.id), { total, grade, territory });
      pods[pod] = (pods[pod] || 0) + 1;

      const p = c.properties;
      const changed = String(p.zia_lead_score ?? '') !== String(total)
        || p.zia_lead_grade !== grade
        || p.zia_territory !== territory
        || p.zia_assigned_pod !== pod;

      if (changed) {
        updates.push({
          id: c.id,
          properties: {
            zia_lead_score: total, zia_lead_grade: grade,
            zia_territory: territory, zia_assigned_pod: pod,
            ...(p.hubspot_owner_id ? {} : { hubspot_owner_id: OWNER_ID }),
          },
        });
      }
    }

    // ---- mirror onto the buyer's deals so the reports work on the free tier ----
    const dealById = new Map(allDeals.map(d => [String(d.id), d]));
    const seededIds = new Set(allDeals.filter(d => d.properties.zia_deal_type).map(d => String(d.id)));
    const dealUpdates = [];
    for (const [contactId, v] of scoredBy) {
      for (const dealId of dealLinks.get(String(contactId)) || []) {
        if (!seededIds.has(String(dealId))) continue;
        const d = dealById.get(String(dealId));
        if (!d) continue;
        const p = d.properties;
        if (String(p.zia_lead_score ?? '') === String(v.total)
          && p.zia_lead_grade === v.grade && p.zia_territory === v.territory) continue;
        dealUpdates.push({
          id: dealId,
          properties: { zia_lead_score: v.total, zia_lead_grade: v.grade, zia_territory: v.territory },
        });
      }
    }

    if (dryRun) {
      return {
        matched: clients.length, wouldWrite: updates.length + dealUpdates.length,
        dealsStamped: dealUpdates.length, grades, territories, pods,
      };
    }

    const r = await batch('contacts', 'update', updates);
    const rd = await batch('deals', 'update', dealUpdates);
    return {
      matched: clients.length, scored: r.ok, dealsStamped: rd.ok,
      failed: r.failed + rd.failed, grades, territories, pods,
    };
  },
};
