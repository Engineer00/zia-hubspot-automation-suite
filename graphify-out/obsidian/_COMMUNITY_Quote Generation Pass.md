---
type: community
cohesion: 0.29
members: 7
---

# Quote Generation Pass

**Cohesion:** 0.29 - loosely connected
**Members:** 7 nodes

## Members
- [[A_2]] - code - zia-automation/realism/p9-quotes.js
- [[HD()_2]] - code - zia-automation/realism/p9-quotes.js
- [[PROPOSAL_PLUS]] - code - zia-automation/realism/p9-quotes.js
- [[isoDate()]] - code - zia-automation/realism/lib.js
- [[p9-quotes.js]] - code - zia-automation/realism/p9-quotes.js
- [[{ api, listAll, batch, readAssociations, STAGE }]] - code - zia-automation/realism/p9-quotes.js
- [[{ rng, isoDate, int, DAY }]] - code - zia-automation/realism/p9-quotes.js

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Quote_Generation_Pass
SORT file.name ASC
```

## Connections to other communities
- 4 edges to [[_COMMUNITY_HubSpot API Client]]
- 3 edges to [[_COMMUNITY_Deterministic RNG Helpers]]
- 2 edges to [[_COMMUNITY_Contact Headroom Pruning]]
- 1 edge to [[_COMMUNITY_PDF Document Builder]]
- 1 edge to [[_COMMUNITY_Win Rate and Invoicing Passes]]

## Top bridge nodes
- [[p9-quotes.js]] - degree 15, connects to 4 communities
- [[isoDate()]] - degree 3, connects to 2 communities