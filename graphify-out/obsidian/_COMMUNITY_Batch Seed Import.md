---
type: community
cohesion: 0.20
members: 17
---

# Batch Seed Import

**Cohesion:** 0.20 - loosely connected
**Members:** 17 nodes

## Members
- [[BATCH_SIZE]] - code - hubspot_setup/import_seed_batches.js
- [[OBJECT_MAP]] - code - hubspot_setup/import_seed_batches.js
- [[ROOT]] - code - hubspot_setup/import_seed_batches.js
- [[createBatchesForObject()]] - code - hubspot_setup/import_seed_batches.js
- [[fs]] - code - hubspot_setup/import_seed_batches.js
- [[hubspotFetch()_1]] - code - hubspot_setup/import_seed_batches.js
- [[import_seed_batches.js]] - code - hubspot_setup/import_seed_batches.js
- [[main()_2]] - code - hubspot_setup/import_seed_batches.js
- [[mapCompanyRow()]] - code - hubspot_setup/import_seed_batches.js
- [[mapContactRow()]] - code - hubspot_setup/import_seed_batches.js
- [[mapDealRow()]] - code - hubspot_setup/import_seed_batches.js
- [[mapTalentRow()]] - code - hubspot_setup/import_seed_batches.js
- [[normalizeContactType()]] - code - hubspot_setup/import_seed_batches.js
- [[normalizeDealType()]] - code - hubspot_setup/import_seed_batches.js
- [[normalizeText()]] - code - hubspot_setup/import_seed_batches.js
- [[parseCsv()]] - code - hubspot_setup/import_seed_batches.js
- [[path]] - code - hubspot_setup/import_seed_batches.js

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Batch_Seed_Import
SORT file.name ASC
```
