#!/usr/bin/env node
/**
 * Lumen HubSpot portal provisioner.
 *
 * Reads config/schema.json and config/pipelines.json and applies them to a
 * HubSpot portal via the CRM v3 API. Idempotent: existing property groups,
 * properties and pipelines are detected and skipped (or patched with --update),
 * so this is safe to run repeatedly while iterating on the design.
 *
 * Usage:
 *   HUBSPOT_TOKEN=pat-na1-xxxx node provision.js            # create what's missing
 *   HUBSPOT_TOKEN=pat-na1-xxxx node provision.js --dry-run  # print the plan only
 *   HUBSPOT_TOKEN=pat-na1-xxxx node provision.js --update   # also patch existing properties
 *
 * Private app scopes required:
 *   crm.objects.contacts.write   crm.schemas.contacts.write
 *   crm.objects.companies.write  crm.schemas.companies.write
 *   crm.objects.deals.write      crm.schemas.deals.write
 *   tickets                      crm.schemas.custom.write (only if you add custom objects)
 *
 * Node 18+ (uses global fetch). No dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const API = 'https://api.hubapi.com';
const TOKEN = process.env.HUBSPOT_TOKEN;
const DRY_RUN = process.argv.includes('--dry-run');
const UPDATE = process.argv.includes('--update');

const schema = readJson('config/schema.json');
const pipelines = readJson('config/pipelines.json');

// Rate limiting: HubSpot allows 100 req/10s on most plans. 120ms between calls
// keeps us comfortably under without needing backoff bookkeeping.
const THROTTLE_MS = 120;

const stats = { created: 0, skipped: 0, updated: 0, failed: 0 };

main().catch((err) => {
  console.error(`\n  fatal: ${err.message}`);
  process.exit(1);
});

async function main() {
  if (!TOKEN && !DRY_RUN) {
    throw new Error('HUBSPOT_TOKEN is not set. Export a private app token, or pass --dry-run.');
  }

  banner();

  for (const [objectType, groups] of Object.entries(schema.propertyGroups)) {
    await provisionGroups(objectType, groups);
  }

  for (const [objectType, props] of Object.entries(schema.properties)) {
    await provisionProperties(objectType, props);
  }

  // The twelve fit criteria are generated rather than hand-listed, so the
  // weights in schema.json stay the single source of truth for both the
  // property definitions and the scoring workflow.
  await provisionProperties('deals', buildFitProperties(schema.fitCriteria));

  for (const [objectType, defs] of Object.entries(pipelines)) {
    if (objectType.startsWith('$')) continue;
    await provisionPipelines(objectType, defs);
  }

  summary();
}

/* ── provisioning steps ─────────────────────────────────────────────── */

async function provisionGroups(objectType, groups) {
  section(`property groups · ${objectType}`);
  const existing = await listNames(`/crm/v3/properties/${objectType}/groups`);

  for (const group of groups) {
    if (existing.has(group.name)) {
      log('skip', group.name, 'already exists');
      stats.skipped++;
      continue;
    }
    await post(`/crm/v3/properties/${objectType}/groups`, {
      name: group.name,
      label: group.label,
      displayOrder: -1,
    }, group.name);
  }
}

async function provisionProperties(objectType, props) {
  if (!props.length) return;
  section(`properties · ${objectType}`);
  const existing = await listNames(`/crm/v3/properties/${objectType}`);

  for (const prop of props) {
    const payload = toPropertyPayload(prop);

    if (existing.has(prop.name)) {
      if (!UPDATE) {
        log('skip', prop.name, 'already exists');
        stats.skipped++;
        continue;
      }
      // name and fieldType are immutable once set; PATCH only what can change.
      const { name, type, fieldType, calculationFormula, ...patch } = payload;
      await patchRequest(`/crm/v3/properties/${objectType}/${prop.name}`, patch, prop.name);
      continue;
    }

    await post(`/crm/v3/properties/${objectType}`, payload, prop.name);
  }
}

async function provisionPipelines(objectType, defs) {
  section(`pipelines · ${objectType}`);
  const existing = await listLabels(`/crm/v3/pipelines/${objectType}`);

  for (const def of defs) {
    if (existing.has(def.label)) {
      log('skip', def.label, 'already exists');
      stats.skipped++;
      continue;
    }
    await post(`/crm/v3/pipelines/${objectType}`, {
      label: def.label,
      displayOrder: def.displayOrder,
      stages: def.stages.map((s) => ({
        label: s.label,
        displayOrder: s.displayOrder,
        metadata: s.metadata,
      })),
    }, def.label);

    // Stage gates (required properties per stage) are not exposed on the public
    // pipelines API. Surface them so they get set once, deliberately, in the UI.
    const gated = def.stages.filter((s) => s.$gate);
    if (gated.length) {
      console.log('         ! set these stage-gate required properties manually:');
      for (const s of gated) {
        console.log(`           ${s.label} → ${s.$gate.join(', ')}`);
      }
    }
  }
}

/* ── payload shaping ────────────────────────────────────────────────── */

function toPropertyPayload(prop) {
  const payload = {
    name: prop.name,
    label: prop.label,
    groupName: prop.groupName,
    type: prop.type,
    fieldType: prop.fieldType,
    description: prop.description || '',
    hasUniqueValue: false,
    hidden: false,
    formField: false,
  };

  if (prop.options) {
    payload.options = prop.options.map((o, i) => ({
      label: o.label,
      value: o.value,
      displayOrder: i,
      hidden: false,
    }));
  }

  // Calculated properties carry a formula instead of stored values. Portals
  // below the required tier reject these — handled as a soft failure below.
  if (prop.calculationFormula) {
    payload.calculationFormula = prop.calculationFormula;
  }

  return payload;
}

function buildFitProperties(fit) {
  const all = [...fit.positive, ...fit.negative];
  return all.map((c) => ({
    name: c.name,
    label: c.label,
    description: `Lumen qualification criterion. Weight ${c.weight > 0 ? '+' : ''}${c.weight} toward lmn_fit_score.`,
    groupName: 'lmn_fit',
    type: 'bool',
    fieldType: 'booleancheckbox',
    options: [
      { label: 'Yes', value: 'true' },
      { label: 'No', value: 'false' },
    ],
  }));
}

/* ── HTTP ───────────────────────────────────────────────────────────── */

async function post(endpoint, body, name) {
  if (DRY_RUN) {
    log('plan', name, `POST ${endpoint}`);
    stats.created++;
    return;
  }
  await sleep(THROTTLE_MS);
  const res = await request('POST', endpoint, body);

  if (res.ok) {
    log('create', name);
    stats.created++;
    return;
  }

  // A calculated property on an unsupported tier is an expected, survivable
  // failure — the rest of the schema still applies cleanly.
  if (body.calculationFormula && res.status === 400) {
    log('warn', name, 'calculated property rejected — create it manually or upgrade tier');
    stats.failed++;
    return;
  }

  log('fail', name, `${res.status} ${res.detail}`);
  stats.failed++;
}

async function patchRequest(endpoint, body, name) {
  if (DRY_RUN) {
    log('plan', name, `PATCH ${endpoint}`);
    stats.updated++;
    return;
  }
  await sleep(THROTTLE_MS);
  const res = await request('PATCH', endpoint, body);
  if (res.ok) {
    log('update', name);
    stats.updated++;
  } else {
    log('fail', name, `${res.status} ${res.detail}`);
    stats.failed++;
  }
}

async function listNames(endpoint) {
  return collect(endpoint, (r) => r.name);
}

async function listLabels(endpoint) {
  return collect(endpoint, (r) => r.label);
}

async function collect(endpoint, pick) {
  if (DRY_RUN && !TOKEN) return new Set();
  await sleep(THROTTLE_MS);
  const res = await request('GET', endpoint);
  if (!res.ok) {
    log('warn', endpoint, `could not read existing (${res.status}) — assuming empty`);
    return new Set();
  }
  return new Set((res.body.results || []).map(pick));
}

async function request(method, endpoint, body) {
  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let parsed = {};
  const text = await res.text();
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = { message: text.slice(0, 200) }; }
  }

  return {
    ok: res.ok,
    status: res.status,
    body: parsed,
    detail: parsed.message || parsed.category || 'unknown error',
  };
}

/* ── output ─────────────────────────────────────────────────────────── */

function banner() {
  console.log('\n  Lumen HubSpot portal provisioner');
  console.log('  ' + '─'.repeat(52));
  if (DRY_RUN) console.log('  DRY RUN — no changes will be made\n');
  else if (UPDATE) console.log('  UPDATE MODE — existing properties will be patched\n');
  else console.log('  CREATE MODE — existing objects are left untouched\n');
}

function section(title) {
  console.log(`\n  ${title}`);
  console.log('  ' + '─'.repeat(52));
}

function log(kind, name, detail = '') {
  const tags = {
    create: '  +  ', update: '  ~  ', skip: '  ·  ',
    plan: '  ?  ', warn: '  !  ', fail: '  x  ',
  };
  console.log(`${tags[kind] || '     '}${name}${detail ? `  ${detail}` : ''}`);
}

function summary() {
  console.log('\n  ' + '─'.repeat(52));
  console.log(`  created ${stats.created}  ·  updated ${stats.updated}  ·  skipped ${stats.skipped}  ·  failed ${stats.failed}`);
  console.log('\n  Next: set the stage-gate required properties listed above,');
  console.log('  then import the CSVs in seed/ (companies, contacts, deals — in that order).\n');
  if (stats.failed > 0) process.exitCode = 1;
}

/* ── util ───────────────────────────────────────────────────────────── */

function readJson(rel) {
  const file = path.join(__dirname, rel);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
