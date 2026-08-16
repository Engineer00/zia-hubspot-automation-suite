'use strict';
/**
 * Minimal HubSpot CRM v3/v4 client.
 * Retries on 429 and 5xx, paginates search and list endpoints.
 */
const fs = require('fs');
const path = require('path');

const KEY_FILE = path.join(__dirname, '..', '..', 'hubspot_service_key.txt');

function loadToken() {
  if (process.env.HUBSPOT_TOKEN) return process.env.HUBSPOT_TOKEN.trim();
  if (process.env.HUBSPOT_ACCESS_TOKEN) return process.env.HUBSPOT_ACCESS_TOKEN.trim();
  if (fs.existsSync(KEY_FILE)) {
    const raw = fs.readFileSync(KEY_FILE, 'utf8');
    const m = raw.match(/pat-[A-Za-z0-9-]+/);
    if (m) return m[0];
  }
  return null;
}

const BASE = 'https://api.hubapi.com';
const TOKEN = loadToken();

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, endpoint, body) {
  let lastNetworkError = null;

  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    try {
      res = await fetch(BASE + endpoint, {
        method,
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      // Transport-level failure — DNS blip, dropped socket, TLS reset. fetch() throws
      // rather than returning a status, so without this catch a single flaky packet
      // aborts an entire run mid-way and leaves the portal half-reconciled.
      // Retried on the same backoff ladder as 429/5xx.
      lastNetworkError = e;
      await sleep(400 * (attempt + 1));
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      // Honour Retry-After when HubSpot sends it; fall back to linear backoff.
      const wait = +res.headers.get('retry-after') * 1000 || 400 * (attempt + 1);
      await sleep(wait);
      continue;
    }

    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`${method} ${endpoint} -> ${res.status} ${text.slice(0, 400)}`);
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : {};
  }
  throw new Error(`${method} ${endpoint} -> retries exhausted`
    + (lastNetworkError ? ` (last transport error: ${lastNetworkError.message})` : ''));
}

/** Page a /search endpoint completely. */
async function searchAll(object, payload) {
  const out = [];
  let after;
  do {
    const body = { limit: 100, ...payload };
    if (after) body.after = after;
    const r = await api('POST', `/crm/v3/objects/${object}/search`, body);
    out.push(...r.results);
    after = r.paging && r.paging.next ? r.paging.next.after : null;
    // search caps at 10k results; guard against runaway loops
    if (out.length >= 10000) break;
  } while (after);
  return out;
}

/** Page a plain list endpoint completely. */
async function listAll(object, properties) {
  const out = [];
  let after;
  do {
    const qs = new URLSearchParams({ limit: '100', properties: properties.join(',') });
    if (after) qs.set('after', after);
    const r = await api('GET', `/crm/v3/objects/${object}?${qs}`);
    out.push(...r.results);
    after = r.paging && r.paging.next ? r.paging.next.after : null;
  } while (after);
  return out;
}

/** Run async fn over items with bounded concurrency. */
async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

/** Batch helper: splits inputs into chunks of 100 and reports success/failure. */
async function batch(object, action, inputs, { dryRun = false, concurrency = 3 } = {}) {
  if (!inputs.length) return { ok: 0, failed: 0 };
  if (dryRun) return { ok: 0, failed: 0, wouldWrite: inputs.length };

  const chunks = [];
  for (let i = 0; i < inputs.length; i += 100) chunks.push(inputs.slice(i, i + 100));

  let ok = 0, failed = 0;
  await pool(chunks, concurrency, async chunk => {
    try {
      const r = await api('POST', `/crm/v3/objects/${object}/batch/${action}`, { inputs: chunk });
      ok += (r.results || chunk).length;
    } catch (e) {
      failed += chunk.length;
      console.error(`    ! ${object}/${action} chunk failed: ${e.message.slice(0, 250)}`);
    }
  });
  return { ok, failed };
}

/** v4 associations for one record. */
async function associations(fromObject, id, toObject) {
  const r = await api('GET', `/crm/v4/objects/${fromObject}/${id}/associations/${toObject}?limit=100`);
  return r.results.map(x => String(x.toObjectId));
}

/**
 * Bulk association read.
 *
 * Returns Map<fromId(string), string[] toIds>.
 *
 * NOTE: HubSpot returns `toObjectId` as a NUMBER while object ids everywhere else
 * are STRINGS. Coercing here is what keeps every dedupe Set in the rules honest —
 * without it `Set.has(deal.id)` silently never matches and rules re-create records
 * they have already created.
 */
async function readAssociations(fromObject, toObject, ids) {
  const map = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const r = await api('POST', `/crm/v4/associations/${fromObject}/${toObject}/batch/read`, {
      inputs: chunk.map(id => ({ id: String(id) })),
    });
    for (const row of r.results || []) {
      map.set(String(row.from.id), (row.to || []).map(t => String(t.toObjectId)));
    }
  }
  return map;
}

/** Flatten readAssociations into a Set of every referenced target id. */
async function associatedIdSet(fromObject, toObject, ids) {
  const map = await readAssociations(fromObject, toObject, ids);
  const set = new Set();
  for (const list of map.values()) for (const id of list) set.add(id);
  return set;
}

const ASSOC = {
  CONTACT_TO_COMPANY: 1,
  DEAL_TO_COMPANY: 5,
  DEAL_TO_CONTACT: 3,
  LINE_ITEM_TO_DEAL: 20,
  TICKET_TO_DEAL: 28,
  TICKET_TO_COMPANY: 26,
  TICKET_TO_CONTACT: 16,
};

const STAGE = {
  LEAD: '4119724776',
  QUALIFIED: '4119724777',
  PROPOSAL: '4119724778',
  NEGOTIATION: '4119724779',
  WON: 'closedwon',
  LOST: 'closedlost',
};

const TICKET_STAGE = { NEW: '1', WAITING_CONTACT: '2', WAITING_US: '3', CLOSED: '4' };

const OWNER_ID = '96903740';
const PIPELINE = 'default';
const TICKET_PIPELINE = '0';

module.exports = {
  api, searchAll, listAll, pool, batch,
  associations, readAssociations, associatedIdSet,
  ASSOC, STAGE, TICKET_STAGE, OWNER_ID, PIPELINE, TICKET_PIPELINE,
};
