'use strict';
/**
 * WF-12  Bench Synchronisation
 *
 * WHY THIS EXISTS
 * `zia_bench_status` is what scheduling reads to decide who is free. It was being
 * maintained by hand, and it had drifted badly: **153 consultants were on active
 * engagements while only 76 were marked `placed`.** Roughly half the delivery team
 * looked available while they were already working.
 *
 * That is not a cosmetic mismatch. The bench report is the input to "who can we put
 * on this?", so a stale one causes double-booking — you promise a client a consultant
 * who has no hours left. It is the same failure as the health score never governing
 * the risk flag: a field is computed, nobody writes it back, and the business acts on
 * the wrong one.
 *
 * THE RULE
 * Assignment is the source of truth, not the field:
 *
 *   on an ACTIVE engagement           -> placed
 *   compliance blocked                -> left alone (WF-06 owns that state)
 *   no active engagement, was placed  -> bench_ready   (rolled off, now available)
 *
 * Consultants in assessment or inactive are never auto-promoted onto the bench —
 * being unassigned is not the same as being ready, and conflating the two is how a
 * bench report starts overstating capacity in the other direction.
 */
const { listAll, batch } = require('../lib/hubspot');

/**
 * OWNERSHIP OF `zia_bench_status` — the reason this list matters.
 *
 * WF-06 holds any consultant with a compliance problem at `in_assessment`. This rule
 * places anyone on an active engagement. A consultant who is BOTH — delivering work
 * *and* compliance-blocked — was being flipped between the two on every run: WF-06
 * wrote 13, WF-12 wrote the same 13 back, forever. Two rules owning one field.
 *
 * **Compliance wins.** It is the safety-critical state, and a credential problem should
 * never be masked by the fact that someone is busy. This list must therefore stay
 * identical to WF-06's trigger set — `expiring_soon` was missing from it, which is
 * exactly where the loop lived.
 *
 * The side effect is a genuine finding rather than a bug: a consultant showing
 * `in_assessment` while attached to a live engagement is the CRM telling you someone
 * is in front of a client on a lapsing credential.
 */
const BLOCKED = ['lapsed', 'not_started', 'expiring_soon'];

module.exports = {
  id: 'WF-12',
  name: 'Bench Synchronisation',

  async run({ dryRun }) {
    const deals = await listAll('deals', [
      'zia_placement_status', 'zia_talent_email', 'zia_deal_type',
    ]);
    const active = deals.filter(d => d.properties.zia_deal_type
      && d.properties.zia_placement_status === 'active');

    // Everyone currently carrying delivery work.
    const working = new Set(active.map(d => d.properties.zia_talent_email).filter(Boolean));

    const contacts = await listAll('contacts', [
      'email', 'zia_contact_type', 'zia_bench_status', 'zia_compliance_status',
    ]);
    const talent = contacts.filter(c => c.properties.zia_contact_type === 'talent');
    if (!talent.length) return { matched: 0, note: 'no consultants' };

    const updates = [];
    const dist = { placed: 0, bench_ready: 0, in_assessment: 0, inactive: 0 };
    let blockedHeld = 0;

    for (const c of talent) {
      const p = c.properties;
      const current = p.zia_bench_status;
      let next = current;

      // Compliance is checked FIRST, before assignment. Putting the `working` branch
      // first meant a compliance-blocked consultant who was also on an engagement
      // never reached this test at all — WF-06 benched them, this rule placed them
      // back, and the two wrote the same 13 records against each other on every run.
      if (BLOCKED.includes(p.zia_compliance_status)) {
        // WF-06 owns this state. Do not undo its work, even for someone who is busy.
        blockedHeld++;
        next = current;
      } else if (working.has(p.email)) {
        next = 'placed';
      } else if (current === 'placed') {
        // Was on an engagement, no longer is — genuinely back on the bench.
        next = 'bench_ready';
      }

      dist[next] = (dist[next] || 0) + 1;
      if (next !== current) updates.push({ id: c.id, properties: { zia_bench_status: next } });
    }

    if (dryRun) {
      return {
        matched: talent.length, working: working.size, wouldWrite: updates.length,
        heldByCompliance: blockedHeld, dist,
      };
    }

    const r = await batch('contacts', 'update', updates);
    return {
      matched: talent.length, working: working.size, changed: r.ok, failed: r.failed,
      heldByCompliance: blockedHeld, dist,
    };
  },
};
