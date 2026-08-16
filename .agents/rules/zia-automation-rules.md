# ZIA Automation System Rules

## 1. Idempotency & Zero-Drift Mandate
- Every automation rule in `zia-automation/rules/` MUST be **idempotent**.
- Re-running `node engine.js` immediately after a successful run MUST return `wrote 0` (zero unnecessary writes).
- Never issue unconditional write calls; always filter to records that require reconciliation.

## 2. HubSpot Free-Tier Compliance
- Respect the **1,000 contact limit** on HubSpot Free (`accountType: STANDARD`).
- Respect single deal pipeline constraint by using `zia_deal_type` ("Engagement Type" label) to segregate Acquisition vs. Placement deals.
- Always inspect network headers for `Retry-After` on `4242` or `5xx` rate limits, applying exponential backoff.

## 3. Process Exit Code Standards
- Node scripts MUST set `process.exitCode` rather than calling `process.exit()` synchronously inside async handles to prevent Windows `libuv` handle assertion errors.

## 4. Validation Engine Standards
- `node validate.js --claims` MUST achieve **39/39 passing narrative claims** and **0 portal drift** against `dashboard-data.json`.
