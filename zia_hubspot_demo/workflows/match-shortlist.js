/**
 * WF-01 · custom coded action — Talent Showcase shortlist
 *
 * Paste into a HubSpot workflow "Custom code" action on the Placements pipeline,
 * triggered when a placement is created at Awaiting Match.
 *
 * Requires Operations Hub Professional or above. If custom code is not available
 * on the portal, the same ranking can be approximated with branch logic on tier
 * and timezone — less precise, but it demonstrates the intent.
 *
 * ── Inputs to map in the action UI ───────────────────────────────────
 *   tier          →  lmn_placement_tier
 *   hoursNeeded   →  lmn_hours_per_week
 *   timezone      →  associated company's lmn_timezone_band (or a deal property)
 *   functionNeeded→  lmn_talent_function requirement captured on the deal
 *
 * ── Outputs to declare ───────────────────────────────────────────────
 *   shortlist       (string)  human-readable top 3, written to a deal note
 *   top_candidate_id(string)  contact id of the best match
 *   match_count     (number)  how many bench-ready candidates qualified
 *
 * ── Secret ───────────────────────────────────────────────────────────
 *   HUBSPOT_TOKEN — private app token with crm.objects.contacts.read
 */

const TIER_RANK = { core: 1, momentum: 2, summit: 3 };

// Weights are deliberate and documented rather than tuned by feel: a placement
// fails most often on capacity and timezone overlap, not on skill breadth.
const WEIGHTS = {
  tierExact: 40,
  tierOverqualified: 15,
  capacityFull: 30,
  capacityPartial: 12,
  timezoneMatch: 20,
  functionOverlap: 10,
};

exports.main = async (event, callback) => {
  const tier = String(event.inputFields.tier || '').toLowerCase();
  const hoursNeeded = Number(event.inputFields.hoursNeeded || 0);
  const timezone = String(event.inputFields.timezone || '').toLowerCase();
  const functionNeeded = String(event.inputFields.functionNeeded || '')
    .toLowerCase()
    .split(';')
    .filter(Boolean);

  const bench = await fetchBench();
  const ranked = bench
    .map((c) => score(c, { tier, hoursNeeded, timezone, functionNeeded }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = ranked.slice(0, 3);

  callback({
    outputFields: {
      shortlist: top.length ? top.map(format).join('\n') : 'No bench-ready match — sourcing required.',
      top_candidate_id: top[0] ? top[0].id : '',
      match_count: ranked.length,
    },
  });
};

/**
 * Pull bench-ready talent only. Filtering server-side rather than in memory
 * keeps this well inside the 20s custom-action timeout as the bench grows.
 */
async function fetchBench() {
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: [{
        filters: [
          { propertyName: 'lmn_contact_type', operator: 'EQ', value: 'talent' },
          { propertyName: 'lmn_bench_status', operator: 'EQ', value: 'bench_ready' },
        ],
      }],
      properties: [
        'firstname', 'lastname', 'lmn_tier_certified', 'lmn_talent_function',
        'lmn_timezone_band', 'lmn_availability_hrs', 'lmn_cost_rate',
      ],
      limit: 100,
    }),
  });

  if (!res.ok) {
    throw new Error(`Bench search failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return (data.results || []).map((r) => ({ id: r.id, ...r.properties }));
}

function score(candidate, need) {
  let total = 0;
  const reasons = [];

  // Tier: an exact match is ideal. Over-qualified is workable but costs margin,
  // so it scores lower rather than higher — a subtlety worth explaining aloud.
  const candidateTier = String(candidate.lmn_tier_certified || '').toLowerCase();
  if (candidateTier === need.tier) {
    total += WEIGHTS.tierExact;
    reasons.push('tier exact');
  } else if (TIER_RANK[candidateTier] > TIER_RANK[need.tier]) {
    total += WEIGHTS.tierOverqualified;
    reasons.push('over-qualified');
  } else {
    return { ...candidate, score: 0, reasons: ['under-tier'] };
  }

  const available = Number(candidate.lmn_availability_hrs || 0);
  if (available >= need.hoursNeeded) {
    total += WEIGHTS.capacityFull;
    reasons.push(`${available}h available`);
  } else if (available >= need.hoursNeeded * 0.6) {
    total += WEIGHTS.capacityPartial;
    reasons.push(`partial capacity (${available}h)`);
  } else {
    return { ...candidate, score: 0, reasons: ['insufficient capacity'] };
  }

  if (String(candidate.lmn_timezone_band || '').toLowerCase() === need.timezone) {
    total += WEIGHTS.timezoneMatch;
    reasons.push('timezone match');
  }

  const fns = String(candidate.lmn_talent_function || '').toLowerCase().split(';');
  const overlap = need.functionNeeded.filter((f) => fns.includes(f));
  if (overlap.length) {
    total += Math.min(overlap.length * WEIGHTS.functionOverlap, WEIGHTS.functionOverlap * 2);
    reasons.push(`${overlap.length} function match`);
  }

  return { ...candidate, score: total, reasons };
}

function format(c) {
  const name = `${c.firstname || ''} ${c.lastname || ''}`.trim() || `Contact ${c.id}`;
  return `${c.score} · ${name} — ${c.reasons.join(', ')}`;
}
