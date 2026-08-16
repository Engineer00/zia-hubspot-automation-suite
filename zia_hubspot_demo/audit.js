#!/usr/bin/env node
/**
 * HubSpot portal auditor.
 *
 * Points at any HubSpot portal and produces a health report: property fill rates,
 * free-text fields that should be constrained, records missing critical data,
 * pipeline stagnation, and ownership gaps. Writes audit-report.md alongside a
 * console summary.
 *
 * This is the day-one deliverable for a CRM architect. Instead of spending week
 * one clicking through settings screens and guessing, you run this and arrive at
 * the kickoff with findings, counts, and a prioritized list.
 *
 * Usage:
 *   HUBSPOT_TOKEN=pat-na1-xxxx node audit.js
 *   HUBSPOT_TOKEN=pat-na1-xxxx node audit.js --objects contacts,deals
 *
 * Scopes needed (read-only — safe to run against a live portal):
 *   crm.objects.contacts.read   crm.schemas.contacts.read
 *   crm.objects.companies.read  crm.schemas.companies.read
 *   crm.objects.deals.read      crm.schemas.deals.read
 *
 * Node 18+. No dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const API = 'https://api.hubapi.com';
const TOKEN = process.env.HUBSPOT_TOKEN;
const THROTTLE_MS = 130;

const argObjects = getArg('--objects');
const OBJECTS = argObjects ? argObjects.split(',') : ['contacts', 'companies', 'deals'];

// A property filled on under this share of records is probably abandoned rather
// than optional. Judgment call, stated openly so it can be argued with.
const LOW_FILL_THRESHOLD = 0.05;
// Deals sitting in one stage longer than this are stalled, not progressing.
const STALE_DEAL_DAYS = 45;

const findings = [];

main().catch((err) => {
  console.error(`\n  fatal: ${err.message}\n`);
  process.exit(1);
});

async function main() {
  if (!TOKEN) throw new Error('HUBSPOT_TOKEN is not set.');

  console.log('\n  HubSpot portal audit');
  console.log('  ' + '─'.repeat(58) + '\n');

  const report = { generated: new Date().toISOString(), objects: {} };

  for (const objectType of OBJECTS) {
    report.objects[objectType] = await auditObject(objectType);
  }

  report.pipelines = await auditPipelines();

  writeReport(report);
  printSummary();
}

/* ── per-object audit ───────────────────────────────────────────────── */

async function auditObject(objectType) {
  console.log(`  ${objectType}`);
  console.log('  ' + '─'.repeat(58));

  const total = await countAll(objectType);
  console.log(`    ${total.toLocaleString()} records`);

  const props = await getProperties(objectType);
  const custom = props.filter((p) => !p.hubspotDefined && !p.calculated);
  console.log(`    ${props.length} properties (${custom.length} custom)`);

  const result = { total, propertyCount: props.length, customCount: custom.length, properties: [] };

  if (total === 0) {
    console.log('    (empty — skipping fill analysis)\n');
    return result;
  }

  // Fill rates on custom properties only. Auditing HubSpot's ~300 defaults
  // would burn the rate limit for findings nobody can act on.
  for (const prop of custom) {
    const filled = await countWithProperty(objectType, prop.name);
    const rate = total > 0 ? filled / total : 0;
    result.properties.push({ name: prop.name, label: prop.label, type: prop.type, fieldType: prop.fieldType, filled, rate });

    if (rate === 0) {
      finding('high', objectType, `Property "${prop.label}" (${prop.name}) is filled on 0 records.`,
        'Delete it, or find out which process was supposed to populate it and never shipped.');
    } else if (rate < LOW_FILL_THRESHOLD) {
      finding('medium', objectType, `Property "${prop.label}" is filled on only ${pct(rate)} of records (${filled}).`,
        'Either it is genuinely optional, or a required step is being skipped. Worth asking which.');
    }

    // Free text on a field people will report on is the single most common
    // cause of unusable dashboards.
    if (prop.fieldType === 'text' && rate > 0.2 && looksCategorical(prop)) {
      finding('high', objectType, `Property "${prop.label}" is free text but looks categorical.`,
        'Convert to a dropdown. Free text here means every report on it will split one value across several rows.');
    }
  }

  const unowned = await countMissing(objectType, 'hubspot_owner_id');
  if (unowned > 0) {
    const rate = unowned / total;
    finding(rate > 0.2 ? 'high' : 'medium', objectType,
      `${unowned.toLocaleString()} records (${pct(rate)}) have no owner.`,
      'Unowned records fall out of every owner-filtered report and nobody is accountable for them.');
  }
  result.unowned = unowned;

  if (objectType === 'contacts') {
    const noEmail = await countMissing('contacts', 'email');
    if (noEmail > 0) {
      finding('medium', 'contacts', `${noEmail.toLocaleString()} contacts have no email address.`,
        'These cannot be marketed to and usually indicate a broken import or form mapping.');
    }
    result.noEmail = noEmail;
  }

  console.log('');
  return result;
}

async function auditPipelines() {
  console.log('  pipelines · deals');
  console.log('  ' + '─'.repeat(58));

  const res = await request('GET', '/crm/v3/pipelines/deals');
  if (!res.ok) {
    console.log('    could not read pipelines\n');
    return [];
  }

  const pipelines = res.body.results || [];
  console.log(`    ${pipelines.length} pipeline(s)`);

  const out = [];
  for (const p of pipelines) {
    const stale = await countStaleInPipeline(p.id);
    console.log(`    ${p.label} — ${p.stages.length} stages, ${stale} stalled >${STALE_DEAL_DAYS}d`);
    out.push({ label: p.label, stages: p.stages.length, stale });

    if (stale > 0) {
      finding('medium', 'deals', `${stale} deal(s) in "${p.label}" have not moved in ${STALE_DEAL_DAYS}+ days.`,
        'Either the pipeline does not match how deals really progress, or nobody is working them. Both are worth knowing before you redesign stages.');
    }
    if (p.stages.length > 8) {
      finding('low', 'deals', `Pipeline "${p.label}" has ${p.stages.length} stages.`,
        'Beyond about seven, reps stop moving deals accurately and stage-based reporting degrades.');
    }
  }

  // A single generic pipeline in a business with distinct processes is the
  // pattern that produces most of the reporting problems worth fixing.
  if (pipelines.length === 1) {
    finding('high', 'deals', 'Only one deal pipeline exists.',
      'If sales, delivery and sourcing all run through one set of stages, none of them can be measured properly.');
  }

  console.log('');
  return out;
}

/* ── counting helpers ───────────────────────────────────────────────── */

async function countAll(objectType) {
  const res = await search(objectType, { filterGroups: [], limit: 1 });
  return res.total || 0;
}

async function countWithProperty(objectType, propertyName) {
  const res = await search(objectType, {
    filterGroups: [{ filters: [{ propertyName, operator: 'HAS_PROPERTY' }] }],
    limit: 1,
  });
  return res.total || 0;
}

async function countMissing(objectType, propertyName) {
  const res = await search(objectType, {
    filterGroups: [{ filters: [{ propertyName, operator: 'NOT_HAS_PROPERTY' }] }],
    limit: 1,
  });
  return res.total || 0;
}

async function countStaleInPipeline(pipelineId) {
  const cutoff = new Date(Date.now() - STALE_DEAL_DAYS * 86400000).toISOString();
  const res = await search('deals', {
    filterGroups: [{
      filters: [
        { propertyName: 'pipeline', operator: 'EQ', value: pipelineId },
        { propertyName: 'hs_lastmodifieddate', operator: 'LT', value: cutoff },
        { propertyName: 'hs_is_closed', operator: 'EQ', value: 'false' },
      ],
    }],
    limit: 1,
  });
  return res.total || 0;
}

async function search(objectType, body) {
  await sleep(THROTTLE_MS);
  const res = await request('POST', `/crm/v3/objects/${objectType}/search`, body);
  return res.ok ? res.body : { total: 0 };
}

async function getProperties(objectType) {
  await sleep(THROTTLE_MS);
  const res = await request('GET', `/crm/v3/properties/${objectType}`);
  return res.ok ? (res.body.results || []) : [];
}

/* ── heuristics ─────────────────────────────────────────────────────── */

/**
 * Names that almost always describe a bounded set of values. Free text on any of
 * these guarantees a report where "Dental", "dental" and "Dental " are three rows.
 */
function looksCategorical(prop) {
  const signals = /(type|status|stage|tier|category|source|region|segment|industry|role|band|priority|reason)$/i;
  return signals.test(prop.name) || signals.test(prop.label);
}

/* ── findings + report ──────────────────────────────────────────────── */

function finding(severity, scope, issue, why) {
  findings.push({ severity, scope, issue, why });
}

function writeReport(report) {
  const order = { high: 0, medium: 1, low: 2 };
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity]);

  const lines = [
    '# HubSpot portal audit',
    '',
    `Generated ${new Date(report.generated).toUTCString()}`,
    '',
    '## Summary',
    '',
    `- Objects audited: ${Object.keys(report.objects).join(', ')}`,
    `- Findings: ${count(sorted, 'high')} high · ${count(sorted, 'medium')} medium · ${count(sorted, 'low')} low`,
    '',
    '## Inventory',
    '',
    '| Object | Records | Properties | Custom | Unowned |',
    '|---|---:|---:|---:|---:|',
  ];

  for (const [name, o] of Object.entries(report.objects)) {
    lines.push(`| ${name} | ${o.total.toLocaleString()} | ${o.propertyCount} | ${o.customCount} | ${(o.unowned || 0).toLocaleString()} |`);
  }

  lines.push('', '## Findings', '');
  if (!sorted.length) {
    lines.push('No issues detected against the current checks.');
  } else {
    for (const f of sorted) {
      lines.push(`### [${f.severity.toUpperCase()}] ${f.scope} — ${f.issue}`, '', f.why, '');
    }
  }

  lines.push('## Property fill rates', '');
  for (const [name, o] of Object.entries(report.objects)) {
    if (!o.properties || !o.properties.length) continue;
    lines.push(`### ${name}`, '', '| Property | Type | Filled | Fill rate |', '|---|---|---:|---:|');
    for (const p of [...o.properties].sort((a, b) => a.rate - b.rate)) {
      lines.push(`| ${p.label} \`${p.name}\` | ${p.fieldType} | ${p.filled.toLocaleString()} | ${pct(p.rate)} |`);
    }
    lines.push('');
  }

  const out = path.join(__dirname, 'audit-report.md');
  fs.writeFileSync(out, lines.join('\n'));
  console.log(`  report written to ${out}\n`);
}

function printSummary() {
  const order = { high: 0, medium: 1, low: 2 };
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity]);

  console.log('  findings');
  console.log('  ' + '─'.repeat(58));
  if (!sorted.length) {
    console.log('    none against the current checks\n');
    return;
  }
  for (const f of sorted.slice(0, 12)) {
    console.log(`    [${f.severity.padEnd(6)}] ${f.issue}`);
  }
  if (sorted.length > 12) console.log(`    … and ${sorted.length - 12} more in the report`);
  console.log(`\n    ${count(sorted, 'high')} high · ${count(sorted, 'medium')} medium · ${count(sorted, 'low')} low\n`);
}

/* ── util ───────────────────────────────────────────────────────────── */

async function request(method, endpoint, body) {
  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = {};
  const text = await res.text();
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = {}; } }
  return { ok: res.ok, status: res.status, body: parsed };
}

function count(list, severity) {
  return list.filter((f) => f.severity === severity).length;
}

function pct(rate) {
  return `${(rate * 100).toFixed(1)}%`;
}

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
