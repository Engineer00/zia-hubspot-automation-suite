#!/usr/bin/env node
'use strict';
/**
 * Local live dashboard, connected to the HubSpot private app.
 *
 * WHY A SERVER AND NOT JUST A FILE
 * The browser cannot call HubSpot directly. Putting the token in client-side
 * JavaScript exposes full read/write access to the CRM to anyone who opens
 * devtools, and HubSpot's API rejects browser origins regardless. So the token
 * stays here, in the Node process, and the page only ever talks to localhost.
 *
 *   node server.js                 http://localhost:4000
 *   node server.js --port 8080
 *   node server.js --every 15      background refresh every 15 minutes
 *   node server.js --no-auto       manual refresh only
 *
 * A pull takes roughly two to three minutes, far too slow to block a page load.
 * So the page always renders instantly from the last snapshot, and refreshing
 * happens in the background — kicked off by the button or the timer.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pull, compute } = require('./snapshot');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : fallback;
};
const PORT = +flag('--port', 4000);
const EVERY_MIN = +flag('--every', 30);
const AUTO = !args.includes('--no-auto');

const TEMPLATE = path.join(__dirname, 'zia-command-deck.html');
const DATA_FILE = path.join(__dirname, 'dashboard-data.json');
const CONTACT_CEILING = 1000;
const STARTED_AT = new Date().toISOString();

/** True once snapshot.js has been edited since this process loaded it. */
const isStale = () => {
  try {
    return fs.statSync(path.join(__dirname, 'snapshot.js')).mtimeMs > new Date(STARTED_AT).getTime();
  } catch { return false; }
};

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

const state = {
  snapshot: null,
  refreshing: false,
  lastRefresh: null,
  lastError: null,
  lastDurationMs: null,
};

try {
  state.snapshot = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  state.lastRefresh = state.snapshot.generatedAt;
  console.log(`loaded cached snapshot from ${state.lastRefresh}`);
} catch {
  console.log('no cached snapshot — the first refresh will populate it');
}

/**
 * Pull from HubSpot and replace the in-memory snapshot.
 * Writes dashboard-data.json too, so build-dashboard.js and validate.js stay
 * consistent with whatever the server last saw.
 */
async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  state.lastError = null;
  const t0 = Date.now();
  console.log(`[${new Date().toISOString()}] refreshing from HubSpot...`);

  try {
    const snap = compute(await pull({ quiet: true }));
    if (isStale()) {
      state.lastError = 'snapshot.js changed since this server started — refusing to serve '
        + 'data computed by stale code. Restart the server.';
      console.error(`  REFUSED: ${state.lastError}`);
      return;
    }
    state.snapshot = snap;
    state.lastRefresh = snap.generatedAt;
    state.lastDurationMs = Date.now() - t0;
    // Stamp which process wrote this, and when the code it ran was last changed.
    // A long-lived server holds `snapshot.js` in Node's module cache, so after that
    // file is edited the server keeps writing snapshots from the OLD code — silently
    // stripping any newly added field out of dashboard-data.json every 30 minutes.
    // That cost hours: fields were fixed, verified, and then quietly reverted by a
    // background process nobody was looking at.
    snap.__writtenBy = 'server.js';
    snap.__serverStartedAt = STARTED_AT;
    // REFUSE, do not merely warn. Node caches snapshot.js at require time, so after that
    // file is edited this process computes snapshots with the OLD code. Warning while
    // still writing meant a background refresh silently stripped newly added fields out
    // of dashboard-data.json — twice. A stale process must not be allowed to publish.
    if (isStale()) {
      state.lastError = 'snapshot.js changed since this server started — refusing to write '
        + 'dashboard-data.json from stale code. Restart the server.';
      console.error(`  REFUSED: ${state.lastError}`);
      return;                              // in-memory snapshot is left untouched too
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(snap, null, 1));
    console.log(`  done in ${(state.lastDurationMs / 1000).toFixed(0)}s — `
      + `${snap.totals.contacts} contacts, ${snap.totals.deals} deals`);
  } catch (e) {
    state.lastError = String(e.message).slice(0, 300);
    console.error(`  refresh failed: ${state.lastError}`);
  } finally {
    state.refreshing = false;
  }
}

/** Contact headroom — the ceiling that silently discards inbound leads. */
function headroom() {
  const contacts = state.snapshot ? state.snapshot.totals.contacts : null;
  if (contacts === null) return null;
  return {
    contacts,
    ceiling: CONTACT_CEILING,
    remaining: CONTACT_CEILING - contacts,
    blocked: contacts >= CONTACT_CEILING,
  };
}

// ---------------------------------------------------------------------------
// the live control bar, injected into the page
// ---------------------------------------------------------------------------

function controlBar() {
  const h = headroom();
  const warn = h && h.blocked;

  return `
<div id="zia-live">
  <span class="dot"></span>
  <span id="zia-when">—</span>
  <button id="zia-refresh" type="button">Refresh from HubSpot</button>
  ${warn ? `<a class="zia-warn" href="#" id="zia-warnlink" title="New contacts cannot be created">
      contact ceiling reached — inbound leads are being discarded</a>` : ''}
</div>
<style>
#zia-live{
  position:fixed; right:18px; bottom:12px; z-index:60;
  display:flex; align-items:center; gap:9px; flex-wrap:wrap; max-width:min(92vw,480px);
  background:rgba(255,255,255,0.92); backdrop-filter:blur(8px); webkit-backdrop-filter:blur(8px);
  border:1px solid var(--hairline); border-radius:9px;
  box-shadow:0 4px 16px rgba(0,0,0,.12); padding:7px 11px;
  font-family:var(--mono); font-size:11px; color:var(--ink-3);
}

#zia-live .dot{width:7px;height:7px;border-radius:50%;background:var(--good);flex:none}
#zia-live.busy .dot{background:var(--warning);animation:ziapulse 1s ease-in-out infinite}
@keyframes ziapulse{0%,100%{opacity:1}50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){#zia-live.busy .dot{animation:none}}
#zia-refresh{
  font-family:var(--mono); font-size:11px; cursor:pointer;
  background:var(--accent-soft); color:var(--accent); border:1px solid var(--accent);
  border-radius:5px; padding:5px 10px;
}
#zia-refresh:hover{background:var(--accent);color:var(--surface)}
#zia-refresh:disabled{opacity:.5;cursor:default}
#zia-refresh:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.zia-warn{
  color:var(--critical); background:var(--critical-bg); border:1px solid var(--critical);
  border-radius:5px; padding:4px 9px; text-decoration:none; font-weight:600;
}
</style>
<script>
(function(){
  var bar=document.getElementById('zia-live'),
      when=document.getElementById('zia-when'),
      btn=document.getElementById('zia-refresh');

  function ago(iso){
    if(!iso) return 'never refreshed';
    var s=Math.round((Date.now()-new Date(iso))/1000);
    if(s<60) return 'live · '+s+'s ago';
    if(s<3600) return 'live · '+Math.round(s/60)+'m ago';
    return 'live · '+Math.round(s/3600)+'h ago';
  }

  function paint(h){
    bar.classList.toggle('busy', !!h.refreshing);
    btn.disabled=!!h.refreshing;
    when.textContent = h.refreshing ? 'pulling from HubSpot…' : ago(h.lastRefresh);
    if(h.lastError) when.textContent='refresh failed — see terminal';
  }

  function poll(){
    fetch('/api/health').then(function(r){return r.json()}).then(function(h){
      paint(h);
      if(h.refreshing){ setTimeout(poll,2000); }
      else if(window.__ziaWasBusy){ location.reload(); }
      window.__ziaWasBusy=h.refreshing;
    }).catch(function(){});
  }

  btn.addEventListener('click',function(){
    btn.disabled=true; when.textContent='pulling from HubSpot…';
    window.__ziaWasBusy=true;
    fetch('/api/refresh',{method:'POST'}).then(poll);
  });

  poll();
  setInterval(poll,30000);
})();
</script>`;
}

// ---------------------------------------------------------------------------
// server
// ---------------------------------------------------------------------------

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body, null, 1));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/health') {
    return json(res, 200, {
      refreshing: state.refreshing,
      lastRefresh: state.lastRefresh,
      lastError: state.lastError,
      lastDurationMs: state.lastDurationMs,
      headroom: headroom(),
      autoRefreshMinutes: AUTO ? EVERY_MIN : null,
      stale: isStale(),
    });
  }

  if (url.pathname === '/api/refresh') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    refresh();                                  // deliberately not awaited
    return json(res, 202, { started: true });
  }

  if (url.pathname === '/api/snapshot') {
    if (!state.snapshot) return json(res, 503, { error: 'no snapshot yet' });
    return json(res, 200, state.snapshot);
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    if (!state.snapshot) {
      res.writeHead(503, { 'Content-Type': 'text/html' });
      return res.end('<p style="font:16px system-ui;padding:40px">'
        + 'No snapshot yet. Run <code>node snapshot.js</code>, or POST /api/refresh.</p>');
    }
    const tpl = fs.readFileSync(TEMPLATE, 'utf8');       // re-read so edits show on reload
    const page = tpl.replace('__DATA__', JSON.stringify(state.snapshot)) + controlBar();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(page);
  }

  json(res, 404, { error: 'not found' });
});

// Bind to loopback only. With no host argument Node listens on 0.0.0.0, which puts
// a full read of the CRM on every interface — anyone on the same Wi-Fi could open it.
// The page is meant for this machine, so it should only be reachable from this machine.
server.listen(PORT, '127.0.0.1', () => {
  const h = headroom();
  console.log('');
  console.log(`  ZIA Command Deck — live   http://localhost:${PORT}`);
  console.log(`  connected to HubSpot portal 247000083`);
  console.log(`  auto-refresh: ${AUTO ? `every ${EVERY_MIN} min` : 'off (manual only)'}`);
  if (h) {
    console.log(`  contacts: ${h.contacts}/${h.ceiling}`
      + (h.blocked ? '  ⚠ CEILING REACHED — inbound leads are being discarded' : `  (${h.remaining} free)`));
  }
  console.log('');

  if (AUTO) setInterval(refresh, EVERY_MIN * 60_000);
});
