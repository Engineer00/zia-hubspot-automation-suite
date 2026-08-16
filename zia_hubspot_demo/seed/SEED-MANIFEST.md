# Seed data manifest

Generated Sat, 15 Aug 2026 11:28:08 GMT · seed `20260809` · defects injected

Regenerate identically with:

```
node generate-seed.js --count 10000 --seed 20260809
```

## Volumes

| File | Rows |
|---|---:|
| `companies.csv` | 10,000 |
| `contacts_clients.csv` | 10,000 |
| `contacts_talent.csv` | 10,000 |
| `deals_acquisition.csv` | 14,886 |
| `deals_placements.csv` | 10,000 |

## Placement book

- Active: **6,517**
- At risk: **792**
- Ended: **2,691**
- Monthly recurring value of the live book: **$13,496,757**

## Referential guarantees

- Every contact references a company domain that exists in `companies.csv`.
- Every placement references a won deal and a talent record that both exist.
- Placement start dates always fall after their deal close date.
- Open deals close in the future; closed deals closed in the past.
- Health scores are consistent with placement status, not random.

## Injected defects

Deliberate, and documented here so audit findings can be verified rather than trusted.
A portal with immaculate data cannot demonstrate the audit tool or the hygiene workflows,
and no real portal is clean.

| Defect | Records | What it demonstrates |
|---|---:|---|
| Missing owner | 2,564 | Records that fall out of every owner-filtered report |
| Missing practice type | 351 | Segment analysis silently incomplete |
| Free-text practice type | 308 | Why the property must be a dropdown — "dental", "Dental", "DSO" become separate rows |
| Duplicate contacts | 250 | Two-sided databases duplicate faster than single-audience ones |
| Missing phone | 1,043 | Common, mostly benign — useful contrast against defects that matter |
| Contradictory dates | 97 | Status Ended with no end date — a validation rule would have blocked it |
| Missing fit score | 731 | Deals that predate the stage gate |

Run `node audit.js` after import; these are the findings it should surface.
