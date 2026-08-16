---
type: community
cohesion: 0.08
members: 61
---

# HubSpot API Client

**Cohesion:** 0.08 - loosely connected
**Members:** 61 nodes

## Members
- [[01-lead-routing.js]] - code - zia-automation/rules/01-lead-routing.js
- [[02-opportunity-lifecycle.js]] - code - zia-automation/rules/02-opportunity-lifecycle.js
- [[03-onboarding.js]] - code - zia-automation/rules/03-onboarding.js
- [[04-health-monitoring.js]] - code - zia-automation/rules/04-health-monitoring.js
- [[05-sla-escalation.js]] - code - zia-automation/rules/05-sla-escalation.js
- [[06-compliance.js]] - code - zia-automation/rules/06-compliance.js
- [[07-collections.js]] - code - zia-automation/rules/07-collections.js
- [[08-inbound.js]] - code - zia-automation/rules/08-inbound.js
- [[10-feedback.js]] - code - zia-automation/rules/10-feedback.js
- [[ALL]] - code - zia-automation/rules/06-compliance.js
- [[APPLY_2]] - code - zia-automation/realism/p16-amount-coherence.js
- [[ASSOC]] - code - zia-automation/lib/hubspot.js
- [[BLOCKING]] - code - zia-automation/rules/06-compliance.js
- [[EMPLOYER]] - code - zia-automation/realism/p11-employer.js
- [[FREEMAIL]] - code - zia-automation/rules/08-inbound.js
- [[KEY_FILE]] - code - zia-automation/lib/hubspot.js
- [[LIFECYCLE_ORDER]] - code - zia-automation/rules/02-opportunity-lifecycle.js
- [[NOTE HubSpot returns `toObjectId` as a NUMBER while object ids everywhere else]] - rationale - zia-automation/lib/hubspot.js
- [[STAGE]] - code - zia-automation/lib/hubspot.js
- [[TICKET_STAGE]] - code - zia-automation/lib/hubspot.js
- [[TOKEN]] - code - zia-automation/lib/hubspot.js
- [[associatedIdSet()]] - code - zia-automation/lib/hubspot.js
- [[associations()]] - code - zia-automation/lib/hubspot.js
- [[batch()]] - code - zia-automation/lib/hubspot.js
- [[categoryOf()_1]] - code - zia-automation/rules/10-feedback.js
- [[domainOf()]] - code - zia-automation/rules/08-inbound.js
- [[fs_4]] - code - zia-automation/lib/hubspot.js
- [[hubspot.js]] - code - zia-automation/lib/hubspot.js
- [[loadToken()]] - code - zia-automation/lib/hubspot.js
- [[money()]] - code - zia-automation/realism/p16-amount-coherence.js
- [[p11-employer.js]] - code - zia-automation/realism/p11-employer.js
- [[p16-amount-coherence.js]] - code - zia-automation/realism/p16-amount-coherence.js
- [[p4-identities.js]] - code - zia-automation/realism/p4-identities.js
- [[path_4]] - code - zia-automation/lib/hubspot.js
- [[pool()]] - code - zia-automation/lib/hubspot.js
- [[rank()]] - code - zia-automation/rules/02-opportunity-lifecycle.js
- [[readAssociations()]] - code - zia-automation/lib/hubspot.js
- [[run()]] - code - zia-automation/rules/01-lead-routing.js
- [[run()_1]] - code - zia-automation/rules/02-opportunity-lifecycle.js
- [[run()_2]] - code - zia-automation/rules/03-onboarding.js
- [[run()_3]] - code - zia-automation/rules/04-health-monitoring.js
- [[run()_4]] - code - zia-automation/rules/05-sla-escalation.js
- [[run()_5]] - code - zia-automation/rules/06-compliance.js
- [[run()_6]] - code - zia-automation/rules/07-collections.js
- [[run()_7]] - code - zia-automation/rules/08-inbound.js
- [[run()_9]] - code - zia-automation/rules/10-feedback.js
- [[searchAll()]] - code - zia-automation/lib/hubspot.js
- [[slug()_1]] - code - zia-automation/realism/p4-identities.js
- [[titleFromDomain()]] - code - zia-automation/rules/08-inbound.js
- [[{   api, searchAll, listAll, batch, readAssociations, associatedIdSet,   ASSOC, TICKET_STAGE, OWNER_ID, TICKET_PIPELINE, }]] - code - zia-automation/rules/08-inbound.js
- [[{   api, searchAll, listAll, batch, readAssociations, associatedIdSet,   ASSOC, TICKET_STAGE, OWNER_ID, TICKET_PIPELINE, }_1]] - code - zia-automation/rules/10-feedback.js
- [[{ api, listAll, pool, readAssociations }_1]] - code - zia-automation/realism/p11-employer.js
- [[{ api, searchAll, batch, readAssociations, associatedIdSet, ASSOC, TICKET_STAGE, OWNER_ID, TICKET_PIPELINE }]] - code - zia-automation/rules/07-collections.js
- [[{ listAll, batch }_2]] - code - zia-automation/realism/p4-identities.js
- [[{ listAll, readAssociations, batch, STAGE }]] - code - zia-automation/realism/p16-amount-coherence.js
- [[{ searchAll, batch, ASSOC, TICKET_STAGE, OWNER_ID, TICKET_PIPELINE }]] - code - zia-automation/rules/06-compliance.js
- [[{ searchAll, batch, OWNER_ID }]] - code - zia-automation/rules/01-lead-routing.js
- [[{ searchAll, batch, readAssociations, associatedIdSet, ASSOC, STAGE, TICKET_STAGE, OWNER_ID, TICKET_PIPELINE }]] - code - zia-automation/rules/03-onboarding.js
- [[{ searchAll, batch, readAssociations, associatedIdSet, ASSOC, TICKET_STAGE, OWNER_ID, TICKET_PIPELINE }]] - code - zia-automation/rules/04-health-monitoring.js
- [[{ searchAll, batch, readAssociations, associatedIdSet, ASSOC, TICKET_STAGE, OWNER_ID, TICKET_PIPELINE }_1]] - code - zia-automation/rules/05-sla-escalation.js
- [[{ searchAll, listAll, batch, readAssociations, STAGE }]] - code - zia-automation/rules/02-opportunity-lifecycle.js

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/HubSpot_API_Client
SORT file.name ASC
```

## Connections to other communities
- 41 edges to [[_COMMUNITY_Contact Headroom Pruning]]
- 6 edges to [[_COMMUNITY_Win Rate and Invoicing Passes]]
- 5 edges to [[_COMMUNITY_Deterministic RNG Helpers]]
- 4 edges to [[_COMMUNITY_Cross-Object Coherence Pass]]
- 4 edges to [[_COMMUNITY_Quote Generation Pass]]
- 3 edges to [[_COMMUNITY_Business Reskin Pass]]
- 3 edges to [[_COMMUNITY_PDF Document Builder]]
- 3 edges to [[_COMMUNITY_Activity Backfill]]
- 3 edges to [[_COMMUNITY_Company Pruning Pass]]
- 2 edges to [[_COMMUNITY_Lead Capture Forms]]
- 2 edges to [[_COMMUNITY_Company Name Repair]]
- 2 edges to [[_COMMUNITY_Live Dashboard Server]]
- 2 edges to [[_COMMUNITY_Claim Validator]]
- 1 edge to [[_COMMUNITY_Lists and Segments]]

## Top bridge nodes
- [[hubspot.js]] - degree 51, connects to 14 communities
- [[batch()]] - degree 41, connects to 10 communities
- [[readAssociations()]] - degree 34, connects to 9 communities
- [[STAGE]] - degree 8, connects to 3 communities
- [[searchAll()]] - degree 20, connects to 1 community