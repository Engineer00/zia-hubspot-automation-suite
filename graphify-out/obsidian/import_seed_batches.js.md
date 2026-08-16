---
source_file: "hubspot_setup/import_seed_batches.js"
type: "code"
community: "Batch Seed Import"
location: "L1"
tags:
  - graphify/code
  - graphify/EXTRACTED
  - community/Batch_Seed_Import
---

# import_seed_batches.js

## Connections
- [[BATCH_SIZE]] - `contains` [EXTRACTED]
- [[OBJECT_MAP]] - `contains` [EXTRACTED]
- [[ROOT]] - `contains` [EXTRACTED]
- [[createBatchesForObject()]] - `contains` [EXTRACTED]
- [[fs]] - `contains` [EXTRACTED]
- [[hubspotFetch()_1]] - `contains` [EXTRACTED]
- [[main()_2]] - `contains` [EXTRACTED]
- [[mapCompanyRow()]] - `indirect_call` [INFERRED]
- [[mapContactRow()]] - `indirect_call` [INFERRED]
- [[mapDealRow()]] - `indirect_call` [INFERRED]
- [[mapTalentRow()]] - `indirect_call` [INFERRED]
- [[normalizeContactType()]] - `contains` [EXTRACTED]
- [[normalizeDealType()]] - `contains` [EXTRACTED]
- [[normalizeText()]] - `contains` [EXTRACTED]
- [[parseCsv()]] - `contains` [EXTRACTED]
- [[path]] - `contains` [EXTRACTED]

#graphify/code #graphify/EXTRACTED #community/Batch_Seed_Import