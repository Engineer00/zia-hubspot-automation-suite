# ARCHIVED — do not import these

These are the **original pre-reskin seed files**. They describe a dental-practice
staffing business that no longer exists:

- `companies.csv` — 10,000 rows of "Wynn Dentistry", "General Dentistry — Solo",
  `.example` domains. **This is the exact file whose double import created the
  20,551-company mess.** Importing it again recreates it.
- `contacts_talent.csv` — `talent0@lumentalent.com`, the synthetic identities P4 replaced
- `deals_*.csv` — dental service types, $12/hour rates, and **no Pipeline or Deal Stage
  column**, which is why the originally planned import could never have worked at all

They are kept only as provenance for the audit story.

## Use these instead

`zia-automation/export/` — generated from the live portal, regenerate any time with:

    node zia-automation/export-csv.js

The portal is the source of truth. A CSV that disagrees with the CRM is worse than no
CSV, because it looks authoritative.
