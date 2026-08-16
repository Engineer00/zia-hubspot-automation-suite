# ZIA — CSV export

Generated 2026-08-16T17:23:16.993Z from HubSpot portal 247000083.

**These files are a view of the live portal, not a source for it.** The portal is
the source of truth; regenerate with `node zia-automation/export-csv.js`.

Headers use HubSpot **import labels**, not internal property names — the import UI
matches on label while the API matches on internal name, and confusing the two is
the most common reason a HubSpot import silently maps nothing.

`Pipeline` and `Deal Stage` are included on both deal files because HubSpot
rejects a deal import without them.

Do not use `zia_hubspot_demo/seed/` — those are the original pre-reskin dental
seed files and describe a business that no longer exists.
