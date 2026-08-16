---
type: community
cohesion: 0.11
members: 28
---

# Live Dashboard Server

**Cohesion:** 0.11 - loosely connected
**Members:** 28 nodes

## Members
- [[DATA_FILE]] - code - zia-automation/server.js
- [[OPEN_STAGES]] - code - zia-automation/snapshot.js
- [[STAGE_LABEL]] - code - zia-automation/snapshot.js
- [[TEMPLATE]] - code - zia-automation/server.js
- [[TIERS]] - code - zia-automation/snapshot.js
- [[TIER_LABEL_1]] - code - zia-automation/snapshot.js
- [[args_2]] - code - zia-automation/server.js
- [[buildSnapshot()]] - code - zia-automation/snapshot.js
- [[compute()]] - code - zia-automation/snapshot.js
- [[controlBar()]] - code - zia-automation/server.js
- [[flag()]] - code - zia-automation/server.js
- [[fs_5]] - code - zia-automation/server.js
- [[fs_6]] - code - zia-automation/snapshot.js
- [[headroom()]] - code - zia-automation/server.js
- [[http]] - code - zia-automation/server.js
- [[json()]] - code - zia-automation/server.js
- [[path_6]] - code - zia-automation/server.js
- [[path_7]] - code - zia-automation/snapshot.js
- [[pull()]] - code - zia-automation/snapshot.js
- [[refresh()]] - code - zia-automation/server.js
- [[server]] - code - zia-automation/server.js
- [[server.js]] - code - zia-automation/server.js
- [[snapshot.js]] - code - zia-automation/snapshot.js
- [[state]] - code - zia-automation/server.js
- [[sumBy()]] - code - zia-automation/snapshot.js
- [[tally()]] - code - zia-automation/snapshot.js
- [[{ listAll, STAGE }]] - code - zia-automation/snapshot.js
- [[{ pull, compute }]] - code - zia-automation/server.js

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Live_Dashboard_Server
SORT file.name ASC
```

## Connections to other communities
- 3 edges to [[_COMMUNITY_Claim Validator]]
- 2 edges to [[_COMMUNITY_HubSpot API Client]]
- 2 edges to [[_COMMUNITY_Contact Headroom Pruning]]

## Top bridge nodes
- [[snapshot.js]] - degree 17, connects to 3 communities
- [[pull()]] - degree 6, connects to 2 communities
- [[compute()]] - degree 7, connects to 1 community