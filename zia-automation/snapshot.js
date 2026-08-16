#!/usr/bin/env node
'use strict';
/**
 * Pulls a complete analytics snapshot from the live portal and writes
 * dashboard-data.json. Run before rebuilding the dashboard.
 */
const fs = require('fs');
const path = require('path');
const { listAll, readAssociations, STAGE } = require('./lib/hubspot');

const STAGE_LABEL = {
  [STAGE.LEAD]: 'Lead',
  [STAGE.QUALIFIED]: 'Qualified Lead',
  [STAGE.PROPOSAL]: 'Proposal Sent',
  [STAGE.NEGOTIATION]: 'Negotiation',
  [STAGE.WON]: 'Closed Won',
  [STAGE.LOST]: 'Closed Lost',
};
const OPEN_STAGES = [STAGE.LEAD, STAGE.QUALIFIED, STAGE.PROPOSAL, STAGE.NEGOTIATION];
const TIERS = ['core', 'momentum', 'summit'];
const TIER_LABEL = { core: 'Core', momentum: 'Momentum', summit: 'Summit' };

const tally = (rows, key, init = {}) => rows.reduce((a, r) => {
  const k = typeof key === 'function' ? key(r) : r.properties[key];
  if (k === undefined || k === null || k === '') return a;
  a[k] = (a[k] || 0) + 1;
  return a;
}, init);

const sumBy = (rows, key, val) => rows.reduce((a, r) => {
  const k = typeof key === 'function' ? key(r) : r.properties[key];
  if (!k) return a;
  a[k] = (a[k] || 0) + (+r.properties[val] || 0);
  return a;
}, {});

/** Pull every object the snapshot and the validator need. */
async function pull({ quiet = false } = {}) {
  const say = m => { if (!quiet) console.log(m); };
  say('pulling deals...');
  const deals = await listAll('deals', [
    'dealname', 'amount', 'closedate', 'dealstage', 'dealtype', 'createdate',
    'zia_deal_type', 'zia_placement_status', 'zia_health_score', 'zia_hours_per_week',
    'zia_hourly_rate', 'zia_seats_committed', 'zia_service_type', 'zia_primary_challenge',
    'zia_embed_start_date', 'zia_embed_end_date',
    'zia_invoice_status', 'zia_invoice_sent_date', 'zia_invoice_paid_date',
    'zia_invoice_due_date', 'zia_days_outstanding', 'zia_payment_terms', 'zia_first_touch_source',
    'zia_match_best_score', 'zia_lead_grade', 'zia_territory',
    'zia_close_probability', 'zia_forecast_category', 'zia_deal_insights',
  ]);

  say('pulling contacts...');
  const contacts = await listAll('contacts', [
    'email', 'zia_contact_type', 'zia_tier', 'zia_bench_status', 'zia_compliance_status',
    'zia_coverage_band', 'zia_hours_per_week', 'zia_cost_rate', 'zia_role',
    'lifecyclestage', 'hs_lead_status', 'zia_source',
    // capability model (P26) — what a consultant can actually do, and how well they have
    'zia_sector_expertise', 'zia_service_lines', 'zia_seniority',
    'zia_years_experience', 'zia_certifications', 'zia_avg_delivered_health',
  ]);

  say('pulling companies...');
  const companies = await listAll('companies', [
    'name', 'domain', 'city', 'state', 'zia_industry', 'zia_client_health',
    'zia_company_stage', 'zia_org_size', 'numberofemployees',
  ]);

  say('pulling tickets...');
  const tickets = await listAll('tickets', [
    'subject', 'zia_ticket_type', 'hs_pipeline_stage', 'hs_ticket_priority',
    'zia_health_score', 'zia_placement_status', 'zia_sla_breached',
  ]);

  say('pulling line items...');
  const lineItems = await listAll('line_items', [
    'name', 'hs_sku', 'price', 'quantity', 'amount', 'discount', 'hs_discount_percentage',
  ]);

  // Deal -> company links, so the book of business can be split into what the
  // organizations in the CRM actually are. Calling all of them "clients" was wrong:
  // most CRMs are mostly pipeline, and saying so is more credible than inflating it.
  say('reading deal associations...');
  const dealCompany = await readAssociations('deals', 'companies', deals.map(d => d.id));

  return { deals, contacts, companies, tickets, lineItems, dealCompany };
}

/** Derive the full analytics snapshot from raw records. Pure — no network. */
function compute({ deals, contacts, companies, tickets, lineItems = [], dealCompany = new Map() }) {
  // ---- filter out HubSpot's sample records ----
  const seededDeals = deals.filter(d => d.properties.zia_deal_type);
  const placements = seededDeals.filter(d => d.properties.zia_placement_status);
  const acquisition = seededDeals.filter(d => !d.properties.zia_placement_status);
  const talent = contacts.filter(c => c.properties.zia_contact_type === 'talent');
  const clients = contacts.filter(c => c.properties.zia_contact_type === 'client_contact');

  const won = seededDeals.filter(d => d.properties.dealstage === STAGE.WON);
  const lost = seededDeals.filter(d => d.properties.dealstage === STAGE.LOST);
  const open = seededDeals.filter(d => OPEN_STAGES.includes(d.properties.dealstage));

  // new business only — delivery engagements are not sales attempts
  const acqWon = acquisition.filter(d => d.properties.dealstage === STAGE.WON);
  const acqLost = acquisition.filter(d => d.properties.dealstage === STAGE.LOST);

  const money = rows => rows.reduce((s, d) => s + (+d.properties.amount || 0), 0);

  // ---- health buckets ----
  const healthBuckets = { 'Critical (<40)': 0, 'At risk (40-59)': 0, 'Watch (60-79)': 0, 'Healthy (80+)': 0 };
  for (const p of placements) {
    const h = +p.properties.zia_health_score || 0;
    if (h < 40) healthBuckets['Critical (<40)']++;
    else if (h < 60) healthBuckets['At risk (40-59)']++;
    else if (h < 80) healthBuckets['Watch (60-79)']++;
    else healthBuckets['Healthy (80+)']++;
  }

  const activePlacements = placements.filter(p => p.properties.zia_placement_status === 'active');
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  // ---- utilisation ----
  const activeHours = activePlacements.map(p => +p.properties.zia_hours_per_week || 0);
  const utilBuckets = { '1-15 hrs': 0, '16-25 hrs': 0, '26-35 hrs': 0, '36+ hrs': 0 };
  for (const h of activeHours) {
    if (h <= 15) utilBuckets['1-15 hrs']++;
    else if (h <= 25) utilBuckets['16-25 hrs']++;
    else if (h <= 35) utilBuckets['26-35 hrs']++;
    else utilBuckets['36+ hrs']++;
  }

  // ---- monthly won revenue trend ----
  const monthly = {};
  for (const d of won) {
    const m = (d.properties.closedate || '').slice(0, 7);
    if (!m) continue;
    monthly[m] = (monthly[m] || 0) + (+d.properties.amount || 0);
  }
  const trend = Object.entries(monthly).sort().map(([month, value]) => ({ month, value }));

  // ---- pipeline funnel ----
  const funnel = [...OPEN_STAGES, STAGE.WON, STAGE.LOST].map(s => ({
    stage: STAGE_LABEL[s],
    count: seededDeals.filter(d => d.properties.dealstage === s).length,
    value: money(seededDeals.filter(d => d.properties.dealstage === s)),
  }));

  // ---- tier economics ----
  const tierStats = TIERS.map(t => {
    const inTier = seededDeals.filter(d => d.properties.zia_deal_type === t);
    const tw = inTier.filter(d => d.properties.dealstage === STAGE.WON);
    const tl = inTier.filter(d => d.properties.dealstage === STAGE.LOST);
    const tp = placements.filter(d => d.properties.zia_deal_type === t);
    // Win rate must exclude delivery engagements. They are all Closed Won by
    // definition, so counting them turns a 30% sales result into 80% — the exact
    // reporting trap this build exists to point out. It must not appear on our
    // own dashboard.
    const ta = acquisition.filter(d => d.properties.zia_deal_type === t);
    const taw = ta.filter(d => d.properties.dealstage === STAGE.WON);
    const tal = ta.filter(d => d.properties.dealstage === STAGE.LOST);
    return {
      tier: TIER_LABEL[t],
      deals: inTier.length,
      won: tw.length,
      lost: tl.length,
      acqDeals: ta.length,
      acqWon: taw.length,
      acqLost: tal.length,
      winRate: taw.length + tal.length ? taw.length / (taw.length + tal.length) : 0,
      acqRevenue: money(taw),
      acqAvgDeal: taw.length ? money(taw) / taw.length : 0,
      revenue: money(tw),
      avgDeal: tw.length ? money(tw) / tw.length : 0,
      placements: tp.length,
      avgHealth: avg(tp.map(p => +p.properties.zia_health_score || 0)),
    };
  });

  // ---- sales efficiency: cycle, velocity, weighted forecast ----
  // The JD names forecasting and pipeline velocity explicitly, and HubSpot free
  // reports neither. All of it is derivable from createdate -> closedate, which
  // the portal already holds.
  const cycleDays = rows => rows
    .map(d => (new Date(d.properties.closedate) - new Date(d.properties.createdate)) / 864e5)
    .filter(n => Number.isFinite(n) && n > 0);

  const median = arr => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  const wonCycle = cycleDays(acqWon);
  const lostCycle = cycleDays(acqLost);
  const acqOpenDeals = acquisition.filter(d => OPEN_STAGES.includes(d.properties.dealstage));
  const acqWinRate = acqWon.length + acqLost.length ? acqWon.length / (acqWon.length + acqLost.length) : 0;
  const acqAvgDeal = acqWon.length ? money(acqWon) / acqWon.length : 0;
  const avgCycle = wonCycle.length ? avg(wonCycle) : 0;

  // Standard pipeline-velocity formula: (opps x win rate x deal size) / cycle length
  const velocityPerDay = avgCycle ? (acqOpenDeals.length * acqWinRate * acqAvgDeal) / avgCycle : 0;

  // Weighted forecast: open pipeline discounted by the historical win rate at each
  // stage. Stage weights are the conventional ladder, not measured transitions —
  // measuring true stage conversion needs historical stage-change events, which a
  // point-in-time snapshot cannot provide. Labelled honestly for that reason.
  const STAGE_WEIGHT = {
    [STAGE.LEAD]: 0.10,
    [STAGE.QUALIFIED]: 0.25,
    [STAGE.PROPOSAL]: 0.50,
    [STAGE.NEGOTIATION]: 0.75,
  };
  const weightedForecast = acqOpenDeals.reduce(
    (s, d) => s + (+d.properties.amount || 0) * (STAGE_WEIGHT[d.properties.dealstage] || 0), 0);

  const salesEfficiency = {
    avgCycleWonDays: avgCycle,
    medianCycleWonDays: median(wonCycle),
    avgCycleLostDays: lostCycle.length ? avg(lostCycle) : 0,
    medianCycleLostDays: median(lostCycle),
    openOpportunities: acqOpenDeals.length,
    velocityPerDay,
    velocityPerMonth: velocityPerDay * 30,
    weightedForecast,
    unweightedOpen: money(acqOpenDeals),
    // shape of the open funnel — NOT cohort conversion, see note above
    openByStage: [...OPEN_STAGES].map(s => ({
      stage: STAGE_LABEL[s],
      count: acqOpenDeals.filter(d => d.properties.dealstage === s).length,
      value: money(acqOpenDeals.filter(d => d.properties.dealstage === s)),
      weight: STAGE_WEIGHT[s],
    })),
  };

  // ---- attribution: where won revenue originated ----
  // No Marketing Hub, so HubSpot's own attribution is unavailable. zia_source is
  // captured on every contact, so first-touch source can be rolled onto the deal.
  const wonBySource = sumBy(acqWon, 'zia_first_touch_source', 'amount');
  const dealsBySource = tally(acquisition, 'zia_first_touch_source');
  const wonCountBySource = tally(acqWon, 'zia_first_touch_source');

  // Revenue per source is the number that matters. Contact counts flatter whichever
  // channel produces the most noise; revenue tells you which one produces business.
  const sourceRoi = Object.keys(dealsBySource).map(src => ({
    source: src,
    deals: dealsBySource[src],
    won: wonCountBySource[src] || 0,
    winRate: dealsBySource[src] ? (wonCountBySource[src] || 0) / dealsBySource[src] : 0,
    revenue: wonBySource[src] || 0,
    avgDeal: wonCountBySource[src] ? (wonBySource[src] || 0) / wonCountBySource[src] : 0,
  })).sort((a, b) => b.revenue - a.revenue);

  const attribution = {
    bySource: tally(contacts.filter(c => c.properties.zia_source), 'zia_source'),
    sourceRoi,
    note: 'first-touch, rolled from contact onto deal by P13 — HubSpot native attribution requires Marketing Hub',
  };

  // ---- loss reasons ----
  const lossReasons = tally(lost.filter(d => d.properties.zia_primary_challenge), 'zia_primary_challenge');

  // ---- service line demand (semicolon multi-value) ----
  const serviceDemand = {};
  for (const d of acquisition) {
    for (const s of (d.properties.zia_service_type || '').split(';').filter(Boolean)) {
      serviceDemand[s.trim()] = (serviceDemand[s.trim()] || 0) + 1;
    }
  }

  // ---- geography ----
  const byState = tally(companies.filter(c => c.properties.state), 'state');

  const openTickets = tickets.filter(t => t.properties.hs_pipeline_stage !== '4');

  const snap = {
    generatedAt: new Date().toISOString(),
    totals: {
      companies: companies.length,
      contacts: contacts.length,
      clients: clients.length,
      talent: talent.length,
      deals: seededDeals.length,
      acquisition: acquisition.length,
      placements: placements.length,
      tickets: tickets.length,
      openTickets: openTickets.length,
    },
    revenue: {
      wonTotal: money(won),
      openPipeline: money(open),
      lostValue: money(lost),
      avgWonDeal: won.length ? money(won) / won.length : 0,
      // portal-wide rate counts delivery engagements as "won" and is therefore
      // meaningless as a sales metric — reported only for reconciliation
      winRate: won.length + lost.length ? won.length / (won.length + lost.length) : 0,
      // the honest sales number: new business only
      acqWon: acqWon.length,
      acqLost: acqLost.length,
      acqOpen: acquisition.length - acqWon.length - acqLost.length,
      acqWinRate: acqWon.length + acqLost.length ? acqWon.length / (acqWon.length + acqLost.length) : 0,
      acqWonValue: money(acqWon),
      acqAvgDeal: acqWon.length ? money(acqWon) / acqWon.length : 0,
      deliveredValue: money(placements),
    },
    // Line-item economics. `amount` is already net of the discount, so the value
    // given away is list (price x quantity) minus amount — never read `discount`,
    // which HubSpot leaves null when the discount was expressed as a percentage.
    discounting: (() => {
      const pct = l => +l.properties.hs_discount_percentage || 0;
      const list = l => (+l.properties.price || 0) * (+l.properties.quantity || 0);
      const net = l => +l.properties.amount || 0;
      const discounted = lineItems.filter(l => pct(l) > 0 || +l.properties.discount > 0);

      return {
        lineItems: lineItems.length,
        discountedLineItems: discounted.length,
        discountRate: lineItems.length ? discounted.length / lineItems.length : 0,
        byDepth: tally(discounted, l => `${pct(l)}%`),
        listValue: lineItems.reduce((a, l) => a + list(l), 0),
        netValue: lineItems.reduce((a, l) => a + net(l), 0),
        valueGivenAway: lineItems.reduce((a, l) => a + (list(l) - net(l)), 0),
        avgDiscountPct: discounted.length ? avg(discounted.map(pct)) : 0,
        byProduct: tally(lineItems, 'name'),
      };
    })(),
    funnel,
    salesEfficiency,
    attribution,
    tierStats,
    trend,
    placements: (() => {
      const highHealthPlacements = activePlacements.filter(p => (+p.properties.zia_health_score || 0) >= 75);
      const bonusPct = 0.10;
      const highHealthValue = highHealthPlacements.reduce((a, p) => a + (+p.properties.amount || 0), 0);
      const totalBonusPool = highHealthValue * bonusPct;

      return {
        active: activePlacements.length,
        ended: placements.filter(p => p.properties.zia_placement_status === 'ended').length,
        atRisk: placements.filter(p => p.properties.zia_placement_status === 'at_risk').length,
        avgHealth: avg(placements.map(p => +p.properties.zia_health_score || 0)),
        avgHours: avg(activeHours),
        totalWeeklyHours: activeHours.reduce((a, b) => a + b, 0),
        healthBuckets,
        utilBuckets,
        consultantBonus: {
          eligibleCount: highHealthPlacements.length,
          bonusPct: 10,
          totalBonusPool,
          avgBonus: highHealthPlacements.length ? totalBonusPool / highHealthPlacements.length : 0,
        },
      };
    })(),
    // ---- deal intelligence: the paid features, replicated ------------------
    // Sales Hub Forecasting, predictive lead scoring and Breeze deal insights are all
    // Professional or Enterprise. WF-14 fits a logistic model on this portal's own
    // closed deals and writes a probability, a forecast category and risk signals onto
    // every open deal — so the free tier gets the same three surfaces, and unlike the
    // paid ones every number here can be explained on the record.
    intelligence: (() => {
      const openAcq = acquisition.filter(d => OPEN_STAGES.includes(d.properties.dealstage));
      const scored = openAcq.filter(d => d.properties.zia_close_probability !== null
        && d.properties.zia_close_probability !== undefined
        && d.properties.zia_close_probability !== '');

      const byCategory = {};
      for (const d of scored) {
        const c = d.properties.zia_forecast_category || 'Unscored';
        const e = byCategory[c] = byCategory[c] || { deals: 0, value: 0, weighted: 0 };
        e.deals++;
        const amt = +d.properties.amount || 0;
        e.value += amt;
        e.weighted += amt * ((+d.properties.zia_close_probability || 0) / 100);
      }

      // Which risk signal fires most often across the open pipeline.
      const signals = {};
      for (const d of scored) {
        const txt = d.properties.zia_deal_insights || '';
        if (!txt || txt === 'No risk signals.') continue;
        for (const line of txt.split('\n')) {
          const key = line.split('—')[0].trim();
          if (key) signals[key] = (signals[key] || 0) + 1;
        }
      }

      const probs = scored.map(d => +d.properties.zia_close_probability || 0).sort((a, b) => a - b);
      return {
        scored: scored.length,
        byCategory,
        signals,
        weighted: scored.reduce((a, d) => a + (+d.properties.amount || 0) * ((+d.properties.zia_close_probability || 0) / 100), 0),
        median: probs.length ? probs[Math.floor(probs.length / 2)] : 0,
        clean: scored.filter(d => (d.properties.zia_deal_insights || '') === 'No risk signals.').length,
      };
    })(),

    // ---- diagnostics + outlook -------------------------------------------
    // The rest of this snapshot is DESCRIPTIVE: it reports what happened. This block
    // is the other two questions a dashboard has to answer — *why* the win rate is
    // what it is, and *what happens next*. Both are derived from the portal's own
    // history, not from an assumption.
    outlook: (() => {
      const closedAcq = acquisition.filter(d => [STAGE.WON, STAGE.LOST].includes(d.properties.dealstage));
      const openAcq = acquisition.filter(d => OPEN_STAGES.includes(d.properties.dealstage));
      const wonOf = rows => rows.filter(d => d.properties.dealstage === STAGE.WON);

      /** Win rate by any dimension, over closed new business only. */
      const cut = keyFn => {
        const g = {};
        for (const d of closedAcq) {
          const k = keyFn(d) || '(not recorded)';
          const e = g[k] = g[k] || { won: 0, lost: 0 };
          if (d.properties.dealstage === STAGE.WON) e.won++; else e.lost++;
        }
        return Object.entries(g)
          .map(([k, v]) => ({ key: k, won: v.won, lost: v.lost, n: v.won + v.lost, rate: v.won / (v.won + v.lost) }))
          .filter(r => r.n >= 8)
          .sort((a, b) => b.rate - a.rate);
      };

      const sizeBand = d => {
        const a = +d.properties.amount || 0;
        return a < 20000 ? 'Under $20k' : a < 40000 ? '$20k-40k' : a < 70000 ? '$40k-70k' : '$70k+';
      };

      // FORECAST. Grade conversion is learned from closed deals, then applied to what
      // is still open — a prediction grounded in this portal's own outcomes rather
      // than the conventional stage ladder, which is a guess dressed as a weighting.
      const ALL_GRADES = ['A', 'B', 'C', 'D'];
      const gradeHist = {};
      for (const d of closedAcq) {
        const g = d.properties.zia_lead_grade || 'Unscored';
        const h = gradeHist[g] = gradeHist[g] || { won: 0, n: 0 };
        h.n++;
        if (d.properties.dealstage === STAGE.WON) h.won++;
      }
      const byGrade = {};
      for (const g of ALL_GRADES) byGrade[g] = { deals: 0, value: 0 };
      for (const d of openAcq) {
        const g = d.properties.zia_lead_grade || 'Unscored';
        const e = byGrade[g] = byGrade[g] || { deals: 0, value: 0 };
        e.deals++; e.value += +d.properties.amount || 0;
      }
      const forecast = Object.entries(byGrade).map(([grade, v]) => {
        const h = gradeHist[grade];
        const rate = h && h.n ? h.won / h.n : 0;
        return { grade, deals: v.deals, value: v.value, rate, expected: v.value * rate };
      }).sort((a, b) => {
        const idxA = ALL_GRADES.indexOf(a.grade), idxB = ALL_GRADES.indexOf(b.grade);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        return b.expected - a.expected;
      });
      const expectedRevenue = forecast.reduce((a, f) => a + f.expected, 0);


      // RISK. Delivery revenue attached to engagements the health model says are failing.
      const failing = activePlacements.filter(p => (+p.properties.zia_health_score || 0) < 60);

      const invAll = seededDeals.filter(d => d.properties.zia_invoice_status);
      const writtenOff = invAll.filter(d => d.properties.zia_invoice_status === 'written_off').length;
      const paid = invAll.filter(d => d.properties.zia_invoice_status === 'paid').length;
      const writeOffRate = paid + writtenOff ? writtenOff / (paid + writtenOff) : 0;
      const old90 = invAll.filter(d => d.properties.zia_invoice_status === 'overdue'
        && +d.properties.zia_days_outstanding > 90);
      const old90Value = money(old90);

      return {
        winBy: {
          grade: cut(d => d.properties.zia_lead_grade),
          source: cut(d => d.properties.zia_first_touch_source),
          size: cut(sizeBand),
          territory: cut(d => d.properties.zia_territory),
        },
        forecast,
        expectedRevenue,
        openValue: money(openAcq),
        deliveryAtRisk: { count: failing.length, of: activePlacements.length, value: money(failing) },
        collections: {
          writeOffRate,
          over90Count: old90.length,
          over90Value: old90Value,
          projectedLoss: old90Value * writeOffRate,
        },
      };
    })(),

    // ---- capability: what the bench can do, and where it cannot serve ----
    // Added because "Specialty experience" is the largest recorded loss reason and,
    // until the expertise model existed, no field could report on it.
    capability: (() => {
      const multi = v => (v || '').split(';').map(x => x.trim()).filter(Boolean);
      const spread = (rows, key) => {
        const out = {};
        for (const r of rows) for (const v of multi(r.properties[key])) out[v] = (out[v] || 0) + 1;
        return out;
      };
      const benchReady = talent.filter(t => t.properties.zia_bench_status === 'bench_ready');
      const healthByGrade = {};
      for (const t of talent) {
        const g = t.properties.zia_seniority;
        const h = +t.properties.zia_avg_delivered_health;
        if (!g || isNaN(h) || !h) continue;
        (healthByGrade[g] = healthByGrade[g] || []).push(h);
      }
      const years = talent.map(t => +t.properties.zia_years_experience).filter(n => n > 0).sort((a, b) => a - b);
      const scored = placements
        .filter(p => p.properties.zia_placement_status === 'active' && p.properties.zia_match_best_score)
        .map(p => +p.properties.zia_match_best_score).sort((a, b) => a - b);

      return {
        sectorExpertise: spread(talent, 'zia_sector_expertise'),
        serviceLines: spread(talent, 'zia_service_lines'),
        benchReadyLines: spread(benchReady, 'zia_service_lines'),
        certifications: spread(talent, 'zia_certifications'),
        grade: tally(talent, 'zia_seniority'),
        avgHealthByGrade: Object.fromEntries(Object.entries(healthByGrade)
          .map(([g, a]) => [g, Math.round(a.reduce((x, y) => x + y, 0) / a.length)])),
        medianYears: years.length ? years[Math.floor(years.length / 2)] : 0,
        match: {
          scored: scored.length,
          median: scored.length ? scored[Math.floor(scored.length / 2)] : 0,
          min: scored.length ? scored[0] : 0,
          max: scored.length ? scored[scored.length - 1] : 0,
          unservable: scored.filter(n => n < 50).length,
        },
      };
    })(),
    talent: {
      bench: tally(talent, 'zia_bench_status'),
      compliance: tally(talent, 'zia_compliance_status'),
      coverage: tally(talent, 'zia_coverage_band'),
      tier: tally(talent, 'zia_tier'),
      avgCostRate: avg(talent.map(t => +t.properties.zia_cost_rate || 0)),
    },
    clients: {
      lifecycle: tally(clients, 'lifecyclestage'),
      leadStatus: tally(clients, 'hs_lead_status'),
      role: tally(clients, 'zia_role'),
    },
    companies: {
      // What the organizations in the CRM actually are. A CRM is mostly pipeline;
      // reporting every record as a "client" overstates the book several times over.
      book: (() => {
        const profile = new Map();
        for (const c of companies) profile.set(String(c.id), { won: 0, lost: 0, open: 0, delivery: 0 });
        for (const d of seededDeals) {
          for (const co of dealCompany.get(String(d.id)) || []) {
            const p = profile.get(String(co)); if (!p) continue;
            if (d.properties.zia_placement_status) p.delivery++;
            else if (d.properties.dealstage === STAGE.WON) p.won++;
            else if (d.properties.dealstage === STAGE.LOST) p.lost++;
            else p.open++;
          }
        }
        const b = { clients: 0, prospects: 0, lost: 0, dormant: 0 };
        for (const p of profile.values()) {
          if (p.won > 0 || p.delivery > 0) b.clients++;
          else if (p.open > 0) b.prospects++;
          else if (p.lost > 0) b.lost++;
          else b.dormant++;
        }
        return b;
      })(),
      industry: tally(companies, 'zia_industry'),
      health: tally(companies, 'zia_client_health'),
      byState,
    },
    tickets: {
      byType: tally(tickets, 'zia_ticket_type'),
      byPriority: tally(tickets, 'hs_ticket_priority'),
      openByType: tally(openTickets, 'zia_ticket_type'),
      slaBreached: tickets.filter(t => t.properties.zia_sla_breached === 'true').length,
    },
    lossReasons,
    serviceDemand,
    invoicing: (() => {
      const inv = seededDeals.filter(d => d.properties.zia_invoice_status);
      const val = s => inv.filter(d => d.properties.zia_invoice_status === s)
                          .reduce((a, d) => a + (+d.properties.amount || 0), 0);
      const paid = inv.filter(d => d.properties.zia_invoice_status === 'paid');

      // days from sent to paid, for the ones that settled
      const lags = paid.map(d => {
        const s = d.properties.zia_invoice_sent_date, p = d.properties.zia_invoice_paid_date;
        return s && p ? Math.round((new Date(p) - new Date(s)) / 864e5) : null;
      }).filter(n => n !== null && n >= 0);

      const agingBuckets = { 'Current': 0, '1–30 days': 0, '31–60 days': 0, '61–90 days': 0, '90+ days': 0 };
      let agingValue = 0;
      for (const d of inv) {
        const st = d.properties.zia_invoice_status;
        if (st === 'paid' || st === 'draft') continue;
        const days = +d.properties.zia_days_outstanding || 0;
        agingValue += +d.properties.amount || 0;
        if (days <= 0) agingBuckets['Current']++;
        else if (days <= 30) agingBuckets['1–30 days']++;
        else if (days <= 60) agingBuckets['31–60 days']++;
        else if (days <= 90) agingBuckets['61–90 days']++;
        else agingBuckets['90+ days']++;
      }

      return {
        total: inv.length,
        byStatus: tally(inv, 'zia_invoice_status'),
        collected: val('paid'),
        outstanding: val('sent') + val('overdue'),
        // Overdue alone — NOT the ageing total, which also carries written-off debt.
        // Pairing "108 overdue invoices" with the ageing figure overstated the
        // collectable position by half a million dollars on the dashboard.
        overdueValue: val('overdue'),
        writtenOff: val('written_off'),
        draft: val('draft'),
        agingBuckets,
        agingValue,
        avgDaysToPay: lags.length ? avg(lags) : 0,
        terms: tally(inv, 'zia_payment_terms'),
      };
    })(),
  };

  return snap;
}

/** Pull + compute in one call. */
async function buildSnapshot(opts) {
  return compute(await pull(opts));
}

module.exports = { pull, compute, buildSnapshot, DATA_FILE: path.join(__dirname, 'dashboard-data.json') };

if (require.main === module) {
  (async () => {
    const snap = await buildSnapshot();
    const out = path.join(__dirname, 'dashboard-data.json');
    fs.writeFileSync(out, JSON.stringify(snap, null, 1));
    console.log(`\nwrote ${out}`);
    console.log(JSON.stringify(snap.totals, null, 1));
    console.log('revenue:', JSON.stringify(snap.revenue, null, 1));
  })();
}
