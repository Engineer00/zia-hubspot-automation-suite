---
name: zia-automation
description: "ZIA Automation Engine & Realism Suite for HubSpot CRM. Executes 15 idempotent backend automation rules (WF-01 to WF-15), snapshot analytics, live dashboard server, and Stripe payment mock."
---

# ZIA Automation Skill — Engineering Loop & Execution Guide

## Overview

The `zia-automation` skill manages CRM workflow automation and data realism for HubSpot Free Tier portals (`accountType: STANDARD`). Since native HubSpot workflows return `403` on Free tier, this skill executes 15 external Node.js automation rules that reconcile state, audit portal drift, and serve the ZIA Command Deck dashboard.

---

## Engine Rules (WF-01 to WF-15)

| Rule ID | Rule Name | Trigger & Description | Target Objects |
|---|---|---|---|
| **WF-01** | Lead Routing | Unassigned client contact → Assigns owner, sets `hs_lead_status = 'NEW'`, `lifecyclestage = 'lead'` | `contacts` |
| **WF-02** | Opportunity Lifecycle | Deal stage changes → Aggregates strongest lifecycle stage onto parent contact | `contacts`, `deals` |
| **WF-03** | Onboarding Automation | Closed-won acquisition deal → Creates placement onboarding ticket | `deals`, `tickets` |
| **WF-04** | Placement Health Monitoring | 30-day placement check → Creates health review ticket | `deals`, `tickets` |
| **WF-05** | SLA Escalation | Overdue ticket / SLA breach → Escalates ticket to manager owner | `tickets` |
| **WF-06** | Compliance Tracking | Expiring consultant credentials → Creates compliance review ticket | `contacts`, `tickets` |
| **WF-07** | Collections | Overdue invoices → Reconciles `zia_days_outstanding`, creates collections ticket | `deals`, `tickets` |
| **WF-08** | Inbound Lead Processing | Form submission / inbound contact → Associates company by domain, routes owner | `contacts`, `companies` |
| **WF-09** | Lead Scoring & Territory | Scans contact properties → Assigns territory pod and computes lead grade (A–D) | `contacts` |
| **WF-10** | Feedback Loop (NPS) | Contact NPS submission → Categorizes detractor/promoter, generates recovery tickets | `contacts`, `tickets` |
| **WF-11** | Engagement Health Model | 5-signal weighted health recalculation (0–100) written to `zia_health_score` | `deals` |
| **WF-12** | Bench Synchronisation | Tracks consultant placement status → Updates `zia_bench_status` (placed, bench_ready, in_assessment) | `contacts` |
| **WF-13** | Consultant Matching | Scans open engagements → Calculates skill match scores and recommends best consultant | `deals`, `contacts` |
| **WF-14** | Deal Intelligence | Machine learning win probability ($74.7\%$ accuracy) → Assigns pipeline category | `deals` |
| **WF-15** | Stripe Payment Reconciliation | Matches simulated Stripe payments → Sets `zia_invoice_status = 'paid'`, zeroes `zia_days_outstanding` | `deals` |

---

## Standard Workflow Loop

```bash
# Step 1: List all available rules
cd zia-automation
node engine.js --list

# Step 2: Run dry-run audit (0 writes)
node engine.js --dry-run

# Step 3: Run live reconciliation engine
node engine.js

# Step 4: Re-calculate analytics snapshot
node snapshot.js

# Step 5: Validate narrative claims and zero drift
node validate.js --claims

# Step 6: Launch live dashboard command deck
node server.js
# Access at http://localhost:4000
```
