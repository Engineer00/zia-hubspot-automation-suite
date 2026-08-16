'use strict';
/**
 * P5 — activity history.
 *
 * An empty Last Activity Date column is the loudest tell that a portal is staged.
 * Real CRMs are thick with calls, emails, meetings, notes and tasks.
 *
 * Every engagement is placed inside its deal's real lifespan (createdate ->
 * closedate) and associated to the deal, its company and its contact, so the
 * timeline on any record reads as a coherent story rather than scattered noise.
 */
const { listAll, batch, readAssociations, OWNER_ID } = require('../lib/hubspot');
const { rng, int, pick, weighted, iso, businessTime, DAY } = require('./lib');

const A = {
  notes:    { contacts: 202, companies: 190, deals: 214 },
  calls:    { contacts: 194, companies: 182, deals: 206 },
  emails:   { contacts: 198, companies: 186, deals: 210 },
  meetings: { contacts: 200, companies: 188, deals: 212 },
  tasks:    { contacts: 204, companies: 192, deals: 216 },
};
const HD = (typeId) => [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: typeId }];

const DISCOVERY = [
  'Discovery call — walked through their org structure, span of control and where decisions stall.',
  'Intro call. Rapid headcount growth has outpaced their management layer; first-time managers are struggling.',
  'Scoping call — mapped the leadership bench, current review cycle and who owns development today.',
  'Qualification call. Confirmed the sponsor, budget owner and target cohort size.',
  'Discovery — engagement survey scores dropped two quarters running; they want the root cause, not a workshop.',
];
const FOLLOWUP = [
  'Sent the program outline and a sample cohort schedule.',
  'Emailed the proposal with cohort size, session cadence and consultant profile.',
  'Follow-up on outstanding questions about measurement and how we report progress to their board.',
  'Shared two anonymised case studies from similar-stage organizations.',
];
const MEETING = [
  'Proposal review with the CHRO and COO.',
  'Working session — agreed scope, cohort structure and success measures.',
  'Stakeholder alignment call with the executive sponsor.',
  'Diagnostic readout — presented findings from the stakeholder interviews.',
];
const WON_NOTE = [
  'Agreement signed. Handing to delivery for consultant assignment and kickoff scheduling.',
  'Closed won. Cohort size and start date confirmed with the sponsor.',
];
const LOST_NOTE = {
  'Rate': 'Lost on price — client went with a lower-cost training vendor.',
  'Learning platform gap': 'Lost — they needed integration with their existing LMS, which we do not support.',
  'Specialty experience': 'Lost — wanted consultants with deeper sector-specific experience.',
  'Coverage hours mismatch': 'Lost — needed delivery across timezones we do not currently staff.',
  'Communication style': 'Lost — sponsor felt the facilitator style was not the right fit for their culture.',
  'Client paused decision': 'No decision — client paused all L&D spend this quarter.',
};
const CHECKIN = [
  'Monthly check-in — cohort attendance steady, sponsor happy with progress.',
  'Progress review: managers applying the feedback model, early behaviour change visible.',
  'Check-in call. Client asked to shift a session to accommodate their planning cycle.',
  'Engagement review — consultant tracking to plan, sponsor satisfied.',
];
const RISK = [
  'Sponsor raised concerns about cohort attendance. Escalating to delivery lead.',
  'Two sessions rescheduled by the client; momentum slipping. Account review scheduled.',
  'Client considering pausing the remaining cohort — retention conversation needed.',
  'Executive sponsor changed mid-engagement; re-selling the value internally.',
];

/**
 * `kinds` limits which engagement types get written — used to re-run a single
 * type after a failure without duplicating the ones that already landed.
 */
module.exports = async function p5({ dryRun, perDeal = 4, kinds = null }) {
  const deals = await listAll('deals', [
    'dealname', 'dealstage', 'createdate', 'closedate', 'zia_deal_type',
    'zia_placement_status', 'zia_primary_challenge', 'zia_health_score',
  ]);
  const seeded = deals.filter(d => d.properties.zia_deal_type);
  console.log(`  deals in scope: ${seeded.length}`);

  const ids = seeded.map(d => d.id);
  const dealCo = await readAssociations('deals', 'companies', ids);
  const dealCt = await readAssociations('deals', 'contacts', ids);

  const bucket = { notes: [], calls: [], emails: [], meetings: [], tasks: [] };

  const assoc = (kind, dealId) => {
    const out = [{ to: { id: dealId }, types: HD(A[kind].deals) }];
    const co = (dealCo.get(dealId) || [])[0];
    const ct = (dealCt.get(dealId) || [])[0];
    if (co) out.push({ to: { id: co }, types: HD(A[kind].companies) });
    if (ct) out.push({ to: { id: ct }, types: HD(A[kind].contacts) });
    return out;
  };

  for (const d of seeded) {
    const r = rng('eng:' + d.id);
    const start = d.properties.createdate ? new Date(d.properties.createdate).getTime() : Date.now() - 200 * DAY;
    const end = d.properties.closedate ? new Date(d.properties.closedate).getTime() : Date.now();
    const span = Math.max(DAY * 3, end - start);
    const isPlacement = !!d.properties.zia_placement_status;
    const won = d.properties.dealstage === 'closedwon';
    const lost = d.properties.dealstage === 'closedlost';

    // when in the deal's life an engagement lands
    const at = frac => businessTime(r, start + span * frac);

    const n = isPlacement ? int(r, 2, 4) : int(r, perDeal - 1, perDeal + 3);

    for (let i = 0; i < n; i++) {
      const frac = (i + 0.5) / n + (r() - 0.5) * 0.12;
      const ts = at(Math.max(0.02, Math.min(0.97, frac)));
      const kind = isPlacement
        ? weighted(r, [['calls', 34], ['notes', 34], ['emails', 22], ['meetings', 10]])
        : weighted(r, [['calls', 30], ['emails', 34], ['notes', 20], ['meetings', 16]]);

      const body = isPlacement
        ? (+d.properties.zia_health_score < 50 ? pick(r, RISK) : pick(r, CHECKIN))
        : (i === 0 ? pick(r, DISCOVERY) : pick(r, FOLLOWUP));

      if (kind === 'calls') {
        bucket.calls.push({ properties: {
          hs_timestamp: iso(ts), hs_call_title: isPlacement ? 'Engagement check-in' : (i === 0 ? 'Discovery call' : 'Follow-up call'),
          hs_call_body: body, hs_call_duration: String(int(r, 8, 42) * 60000),
          hs_call_direction: weighted(r, [['OUTBOUND', 72], ['INBOUND', 28]]),
          hs_call_status: 'COMPLETED', hubspot_owner_id: OWNER_ID,
        }, associations: assoc('calls', d.id) });
      } else if (kind === 'emails') {
        bucket.emails.push({ properties: {
          hs_timestamp: iso(ts), hs_email_subject: isPlacement ? `Engagement update — ${d.properties.dealname}` : `ZIA proposal — ${d.properties.dealname}`,
          hs_email_text: body, hs_email_direction: weighted(r, [['EMAIL', 70], ['INCOMING_EMAIL', 30]]),
          hs_email_status: 'SENT', hubspot_owner_id: OWNER_ID,
        }, associations: assoc('emails', d.id) });
      } else if (kind === 'meetings') {
        // ts is a Date — take epoch ms BEFORE adding, or `ts + dur` string-concatenates
        const t0 = ts.getTime();
        const dur = int(r, 30, 60) * 60000;
        bucket.meetings.push({ properties: {
          hs_timestamp: iso(t0), hs_meeting_title: isPlacement ? 'Engagement review' : pick(r, ['Proposal review', 'Scoping session', 'Stakeholder alignment', 'Diagnostic readout']),
          hs_meeting_body: isPlacement ? pick(r, CHECKIN) : pick(r, MEETING),
          hs_meeting_start_time: iso(t0), hs_meeting_end_time: iso(t0 + dur),
          hs_meeting_outcome: 'COMPLETED', hubspot_owner_id: OWNER_ID,
        }, associations: assoc('meetings', d.id) });
      } else {
        bucket.notes.push({ properties: {
          hs_timestamp: iso(ts), hs_note_body: body, hubspot_owner_id: OWNER_ID,
        }, associations: assoc('notes', d.id) });
      }
    }

    // a closing note that matches the outcome
    if (won) {
      bucket.notes.push({ properties: {
        hs_timestamp: iso(businessTime(r, end)), hs_note_body: pick(r, WON_NOTE), hubspot_owner_id: OWNER_ID,
      }, associations: assoc('notes', d.id) });
    } else if (lost) {
      const reason = d.properties.zia_primary_challenge;
      bucket.notes.push({ properties: {
        hs_timestamp: iso(businessTime(r, end)),
        hs_note_body: (reason && LOST_NOTE[reason]) || 'Closed lost — the client chose another route.',
        hubspot_owner_id: OWNER_ID,
      }, associations: assoc('notes', d.id) });
    } else {
      // open deal -> an outstanding next step, which is what a live pipeline looks like
      bucket.tasks.push({ properties: {
        hs_timestamp: iso(businessTime(r, Date.now() + int(r, 1, 21) * DAY)),
        hs_task_subject: pick(r, ['Send revised cohort schedule', 'Chase proposal decision', 'Book executive sponsor call', 'Confirm measurement approach']),
        hs_task_body: 'Next step on an open opportunity.',
        hs_task_status: 'NOT_STARTED',
        hs_task_priority: weighted(r, [['HIGH', 22], ['MEDIUM', 52], ['LOW', 26]]),
        hubspot_owner_id: OWNER_ID,
      }, associations: assoc('tasks', d.id) });
    }
  }

  const total = Object.values(bucket).reduce((s, a) => s + a.length, 0);
  console.log(`  engagements to create: ${total}`);
  for (const [k, v] of Object.entries(bucket)) console.log(`     ${k.padEnd(9)} ${v.length}`);

  const out = {};
  for (const [kind, inputs] of Object.entries(bucket)) {
    if (!inputs.length) continue;
    if (kinds && !kinds.includes(kind)) { console.log(`     ${kind} skipped (not in --kinds)`); continue; }
    const res = await batch(kind, 'create', inputs, { dryRun, concurrency: 3 });
    out[kind] = res.ok;
    if (res.failed) console.log(`     ! ${kind} failed: ${res.failed}`);
  }

  return { total, ...out, wouldWrite: dryRun ? total : undefined };
};
