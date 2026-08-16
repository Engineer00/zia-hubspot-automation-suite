# Lumen HubSpot Demo Portal — provisioning as code

The architecture in the [system design walkthrough](https://claude.ai/code/artifact/d25ca0dc-c8fe-4adc-96cb-b75f10158d8d),
expressed as a version-controlled schema plus a script that applies it to a HubSpot portal.

Clicking through the HubSpot UI produces a portal. This produces a portal **and** a
reproducible definition of it — which is the difference between configuring a CRM and
architecting one.

---

## Why this exists

The Lumen JD asks for HubSpot API familiarity, comfort documenting processes, and someone
who builds systems that scale. Those three things point at the same practice: the portal's
structure should live in a file someone can read, review and re-apply, not only in a
settings screen someone has to remember to reproduce.

Concretely, this repo gives you:

| Capability | Where |
|---|---|
| Every custom property, typed and described | `config/schema.json` |
| Three pipelines using Lumen's own process vocabulary | `config/pipelines.json` |
| Idempotent provisioner with dry-run and update modes | `provision.js` |
| Talent-matching logic as a custom coded action | `workflows/match-shortlist.js` |
| Realistic seed data for a demo that isn't empty | `seed/*.csv` |

---

## Setup

**Requirements:** Node 18+ (uses global `fetch`). No dependencies to install.

1. In HubSpot: **Settings → Integrations → Private Apps → Create a private app**
2. Grant these scopes:

   ```
   crm.objects.contacts.write    crm.schemas.contacts.write
   crm.objects.companies.write   crm.schemas.companies.write
   crm.objects.deals.write       crm.schemas.deals.write
   tickets
   ```

3. Copy the access token.

```bash
cd lmn_hubspot_demo

# See the plan without touching the portal
node provision.js --dry-run

# Apply it
HUBSPOT_TOKEN=pat-na1-xxxxxxxx node provision.js

# Re-run after editing schema.json to patch labels, descriptions and options
HUBSPOT_TOKEN=pat-na1-xxxxxxxx node provision.js --update
```

On PowerShell, set the token first:

```powershell
$env:HUBSPOT_TOKEN = "pat-na1-xxxxxxxx"
node provision.js
```

The script is **idempotent** — it reads what already exists and skips it. Run it as many
times as you like while iterating.

---

## What the script cannot do, and why that's stated rather than hidden

Two things are deliberately left as manual steps, because the public API does not expose them:

- **Stage-gate required properties.** The pipelines API creates stages but not their
  required-property rules. The script prints exactly which properties to mark required on
  which stage, so it takes two minutes and nothing is guessed.
- **Workflows.** HubSpot has no public create-workflow API. The six workflows are specified
  in the [build sheet](https://claude.ai/code/artifact/51b2e647-31cf-4e29-a5b3-77afb5c988a4)
  and built in the UI.

One thing may fail depending on subscription:

- **Calculated properties** (`lmn_monthly_value`) require a tier that supports them. The
  script treats a rejection as a warning rather than a crash, tells you, and continues.

---

## Build order

Order matters. Anything built out of sequence gets rebuilt.

1. `node provision.js` — property groups, properties, pipelines
2. Set the stage-gate required properties the script printed
3. Import CSVs in this exact order — HubSpot resolves associations on import:
   1. `seed/companies.csv`
   2. `seed/contacts_clients.csv`
   3. `seed/contacts_talent.csv`
   4. `seed/deals_acquisition.csv`
   5. `seed/deals_placements.csv`
4. Build the six workflows from the build sheet, WF-02 first (contact type enforcement —
   everything downstream filters on it)
5. Build the executive dashboard, then the three department dashboards
6. Rehearse the seven-step demo run twice before presenting

---

## The seed data

Fictional organizations, chosen to mirror Lumen's real reference base — private-practice
healthcare, with a speaker/KOL and a professional-services account for contrast. All domains
use `.example`, which is reserved by RFC 2606 and cannot resolve, so nothing here can reach
a real organization.

The data is shaped to make every dashboard tile show something:

- **Northline Dental** — one deal, three placements, one on a higher tier. The Deal ≠ Placement
  argument, visible in the data.
- **Ridgeway Family Dental** — health score 34, documentation missing, last check-in in June.
  This is the at-risk alert demo.
- **Beacon Rehab** — an ended placement, so churn and net revenue retention have something to
  compute against.
- **Meridian Ortho** — sitting at Agreement Sent with a placement Awaiting Match. **This is the
  record you drag to Closed Won in the live demo.**
- **Fieldstone Advisory** — Closed Lost with `Temp / short-term gap`, drawn from Lumen's own
  published "not a fit" list, so the fit-score report has a real disqualifier to show.

---

## The matching action

`workflows/match-shortlist.js` ranks bench-ready talent for a placement. Three details worth
being able to defend if asked:

- **Filtering happens server-side** in the search request, not in memory. The action stays
  inside its 20-second timeout as the bench grows.
- **Over-qualified scores lower than exact-tier**, not higher. A Summit in a Momentum seat
  is a margin problem, and the ranking should say so.
- **Under-tier and insufficient-capacity return zero and drop out** rather than ranking low.
  A candidate who cannot do the job is not a weak match; they are not a match.

It requires Operations Hub Professional or above. If custom code is unavailable on the trial,
approximate it with branch logic on tier and timezone, and say in the demo that the production
version is this file. Never demo a step you had to fake.

---

## Structure

```
lmn_hubspot_demo/
├── README.md
├── provision.js                  # idempotent provisioner, no dependencies
├── config/
│   ├── schema.json               # every property group, property and fit criterion
│   └── pipelines.json            # three pipelines with stage gates annotated
├── workflows/
│   └── match-shortlist.js        # custom coded action for the showcase shortlist
└── seed/
    ├── companies.csv
    ├── contacts_clients.csv
    ├── contacts_talent.csv
    ├── deals_acquisition.csv
    └── deals_placements.csv
```
