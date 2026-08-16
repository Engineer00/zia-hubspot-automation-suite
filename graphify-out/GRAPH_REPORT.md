# Graph Report - .  (2026-08-17)

## Corpus Check
- 155 files · ~220,557 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 614 nodes · 1131 edges · 43 communities (38 shown, 5 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 36 edges (avg confidence: 0.52)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41

## God Nodes (most connected - your core abstractions)
1. `batch()` - 55 edges
2. `listAll()` - 54 edges
3. `readAssociations()` - 50 edges
4. `api()` - 48 edges
5. `searchAll()` - 20 edges
6. `STAGE` - 16 edges
7. `rng()` - 16 edges
8. `associatedIdSet()` - 14 edges
9. `ASSOC` - 14 edges
10. `buildTalent()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `loadLabels()` --calls--> `api()`  [EXTRACTED]
  zia-automation/export-csv.js → zia-automation/lib/hubspot.js
- `daysSince()` --indirect_call--> `iso()`  [INFERRED]
  zia-automation/rules/11-health-model.js → zia-automation/realism/lib.js
- `attach()` --calls--> `api()`  [EXTRACTED]
  zia-automation/realism/p10-attachments.js → zia-automation/lib/hubspot.js
- `ensure()` --calls--> `api()`  [EXTRACTED]
  zia-automation/realism/p14-nps.js → zia-automation/lib/hubspot.js
- `run()` --calls--> `api()`  [EXTRACTED]
  zia-automation/rules/08-inbound.js → zia-automation/lib/hubspot.js

## Import Cycles
- None detected.

## Communities (43 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (52): addDays(), ASSESSMENT, BAA_STATUS, buildAcquisitionDeals(), buildClientContacts(), buildCompanies(), buildPlacements(), buildTalent() (+44 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (46): args, controlBar(), DATA_FILE, fs, headroom(), http, isStale(), json() (+38 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (30): STAGE, APPLY, { listAll, readAssociations, batch, STAGE }, APPLY, { listAll, batch, STAGE }, monthOf(), shape(), { api, listAll, batch, readAssociations, STAGE } (+22 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (21): api(), associations(), sleep(), { api, listAll, batch }, { api, listAll, batch, readAssociations }, COMMENTS, COMPANY_PROPS, CONTACT_PROPS (+13 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (28): asciify(), buildPdf(), esc(), textWidth(), W, widthOf(), wrap(), rng() (+20 more)

### Community 5 - "Community 5"
Cohesion: 0.18
Nodes (24): banner(), buildFitProperties(), collect(), DRY_RUN, fs, listLabels(), listNames(), log() (+16 more)

### Community 6 - "Community 6"
Cohesion: 0.19
Nodes (21): argObjects, auditObject(), auditPipelines(), count(), countAll(), countMissing(), countStaleInPipeline(), countWithProperty() (+13 more)

### Community 7 - "Community 7"
Cohesion: 0.25
Nodes (16): ASSOC, associatedIdSet(), readAssociations(), searchAll(), TICKET_STAGE, run(), { searchAll, batch, readAssociations, associatedIdSet, ASSOC, STAGE, TICKET_STAGE, OWNER_ID, TICKET_PIPELINE }, run() (+8 more)

### Community 8 - "Community 8"
Cohesion: 0.20
Nodes (16): BATCH_SIZE, createBatchesForObject(), fs, hubspotFetch(), main(), mapCompanyRow(), mapContactRow(), mapDealRow() (+8 more)

### Community 9 - "Community 9"
Cohesion: 0.18
Nodes (13): computeStripeSignature(), crypto, db, evaluateCardNumber(), genId(), http, jsonRes(), parseFormOrJson() (+5 more)

### Community 10 - "Community 10"
Cohesion: 0.17
Nodes (15): iso(), { api, listAll, batch, readAssociations, OWNER_ID }, daysSince(), DEAL_PROPS, ensureDealProperties(), ensureProperties(), PODS, PROPS (+7 more)

### Community 11 - "Community 11"
Cohesion: 0.16
Nodes (13): RFC-4180, { api, listAll, readAssociations, STAGE }, cell(), dIdx, fs, LABELS, LBL(), loadLabels() (+5 more)

### Community 12 - "Community 12"
Cohesion: 0.19
Nodes (10): clamp(), int(), logNormal(), normal(), FLOOR, { listAll, batch, readAssociations }, NOW, { rng, logNormal, int, clamp, DAY, iso, businessTime } (+2 more)

### Community 13 - "Community 13"
Cohesion: 0.18
Nodes (11): { api, listAll, readAssociations }, APPLY, args, tIdx, listAll(), LIFECYCLE_ORDER, rank(), run() (+3 more)

### Community 14 - "Community 14"
Cohesion: 0.15
Nodes (9): fs, KEY_FILE, path, pool(), NOTE: HubSpot returns `toObjectId` as a NUMBER while object ids everywhere else, TOKEN, { api, listAll, pool, readAssociations }, EMPLOYER (+1 more)

### Community 15 - "Community 15"
Cohesion: 0.17
Nodes (12): DATA, DEST, dig(), fs, missing, out, path, raw (+4 more)

### Community 16 - "Community 16"
Cohesion: 0.19
Nodes (10): batch(), run(), { searchAll, batch, OWNER_ID }, ALL, BLOCKING, run(), { searchAll, batch, ASSOC, TICKET_STAGE, OWNER_ID, TICKET_PIPELINE }, BLOCKED (+2 more)

### Community 17 - "Community 17"
Cohesion: 0.15
Nodes (10): { api, listAll, readAssociations, ASSOC }, APPLY, BENCH, BILL, COMPLIANCE, COVERAGE, FIRST, LAST (+2 more)

### Community 18 - "Community 18"
Cohesion: 0.15
Nodes (8): { api, listAll, batch, readAssociations }, APPLY, CERTS, PROPS, SECTOR_LABEL, SECTORS, SERVICE_LINES, TIER

### Community 19 - "Community 19"
Cohesion: 0.17
Nodes (10): A, CHECKIN, DISCOVERY, FOLLOWUP, { listAll, batch, readAssociations, OWNER_ID }, LOST_NOTE, MEETING, RISK (+2 more)

### Community 20 - "Community 20"
Cohesion: 0.18
Nodes (8): weighted(), { listAll, batch, STAGE }, { rng, weighted }, { api, listAll, batch, STAGE }, PROPS, { rng, weighted, int, isoDate, DAY, clamp }, TERM_DAYS, TODAY

### Community 21 - "Community 21"
Cohesion: 0.27
Nodes (10): { api, listAll, batch, readAssociations, STAGE }, auc(), fit(), GRADE_ORD, OPEN_STAGES, predict(), PROPS, run() (+2 more)

### Community 22 - "Community 22"
Cohesion: 0.22
Nodes (7): { api }, chunk(), DRY, FORMS, fs, path, payload()

### Community 23 - "Community 23"
Cohesion: 0.20
Nodes (8): { api, listAll, batch, readAssociations }, PROFILES, PROGRAM, { rng, pick, weighted, int }, ROLES, SECTORS, SERVICES, STEMS

### Community 24 - "Community 24"
Cohesion: 0.27
Nodes (9): buildIndex(), escapeHtml(), findFragments(), fs, getArg(), OUT, PAGES, path (+1 more)

### Community 25 - "Community 25"
Cohesion: 0.50
Nodes (8): createPipeline(), createPropertiesForObject(), getExistingProperties(), hubspotFetch(), listPipelines(), main(), PROPERTY_DEFS, validateToken()

### Community 26 - "Community 26"
Cohesion: 0.22
Nodes (7): businessTime(), A, { api, listAll, batch, readAssociations, OWNER_ID }, PROSPECT_CALL, PROSPECT_EMAIL, PROSPECT_NOTE, { rng, pick, weighted, int, iso, businessTime, DAY }

### Community 27 - "Community 27"
Cohesion: 0.25
Nodes (5): { api, listAll, batch, readAssociations }, APPLY, BILL, HOURLY_SKU, PROGRAMME_SKU

### Community 28 - "Community 28"
Cohesion: 0.29
Nodes (4): fs, LOG_FILE, path, RULES_DIR

### Community 29 - "Community 29"
Cohesion: 0.29
Nodes (5): isoDate(), A, { api, listAll, batch, readAssociations, STAGE }, PROPOSAL_PLUS, { rng, isoDate, int, DAY }

### Community 30 - "Community 30"
Cohesion: 0.29
Nodes (5): pick(), { api, listAll, batch, readAssociations, ASSOC }, CT_CO, DEAL_CT, { rng, weighted, pick }

### Community 31 - "Community 31"
Cohesion: 0.29
Nodes (5): APPLY, FALLBACK, { listAll, batch }, PREFIX, SUFFIX

### Community 32 - "Community 32"
Cohesion: 0.38
Nodes (6): { api, listAll, batch, readAssociations }, clamp01(), daysSince(), PROPS, run(), WEIGHTS

### Community 33 - "Community 33"
Cohesion: 0.43
Nodes (6): fetchBench(), format(), main(), score(), TIER_RANK, WEIGHTS

### Community 34 - "Community 34"
Cohesion: 0.40
Nodes (5): apiRequest(), groupNameByObject, https, main(), properties

### Community 35 - "Community 35"
Cohesion: 0.47
Nodes (5): {
  api, searchAll, listAll, batch, readAssociations, associatedIdSet,
  ASSOC, TICKET_STAGE, OWNER_ID, TICKET_PIPELINE,
}, domainOf(), FREEMAIL, run(), titleFromDomain()

### Community 37 - "Community 37"
Cohesion: 0.50
Nodes (3): APPLY, BLOCKED, { listAll, batch, api, ASSOC }

## Knowledge Gaps
- **299 isolated node(s):** `PROPERTY_DEFS`, `https`, `groupNameByObject`, `properties`, `https` (+294 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `listAll()` connect `Community 13` to `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 7`, `Community 10`, `Community 11`, `Community 12`, `Community 14`, `Community 16`, `Community 17`, `Community 18`, `Community 19`, `Community 20`, `Community 21`, `Community 23`, `Community 26`, `Community 27`, `Community 29`, `Community 30`, `Community 31`, `Community 32`, `Community 35`, `Community 36`, `Community 37`, `Community 38`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `readAssociations()` connect `Community 7` to `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 10`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 17`, `Community 18`, `Community 19`, `Community 21`, `Community 23`, `Community 26`, `Community 27`, `Community 29`, `Community 30`, `Community 32`, `Community 35`, `Community 36`, `Community 38`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Why does `api()` connect `Community 3` to `Community 1`, `Community 2`, `Community 4`, `Community 7`, `Community 10`, `Community 11`, `Community 13`, `Community 14`, `Community 16`, `Community 17`, `Community 18`, `Community 20`, `Community 21`, `Community 22`, `Community 23`, `Community 26`, `Community 27`, `Community 29`, `Community 30`, `Community 32`, `Community 35`, `Community 37`, `Community 38`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **What connects `PROPERTY_DEFS`, `https`, `groupNameByObject` to the rest of the system?**
  _299 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05725490196078432 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.044444444444444446 - nodes in this community are weakly interconnected._