#!/usr/bin/env node
/**
 * Builds a standalone static site from the report fragments.
 *
 * The report files are HTML fragments — they carry a <title> and <style> and the
 * page body, but no doctype, <html>, <head> or <body>. That is fine where a host
 * wraps them, but a static host serves the file as-is. This wraps each one into a
 * complete, valid document and writes them to site/ ready to deploy.
 *
 * Usage:
 *   node build-site.js            # build into ./site
 *   node build-site.js --open     # build, then print the local preview command
 *
 * Deploying to Vercel:
 *   npm i -g vercel
 *   cd site && vercel            # preview URL
 *   cd site && vercel --prod     # production URL
 *
 * Node 18+. No dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SRC = process.env.REPORT_SRC || path.join(
  process.env.LOCALAPPDATA || process.env.HOME || '',
  'Temp', 'claude'
);

const OUT = path.join(__dirname, 'site');

/**
 * Each report, in the order it should appear on the index. `file` is the source
 * fragment name; `slug` becomes the URL path.
 */
const PAGES = [
  {
    file: 'zia-hubspot-system-design.html',
    slug: 'system-design',
    title: 'System Design',
    blurb: 'The complete architecture — data model, pipelines, automation, marketing operations, attribution and reporting. Start here.',
  },
  {
    file: 'hubspot-case-study.html',
    slug: 'case-study',
    title: 'Case Study',
    blurb: 'The CRM restructure told as a narrative: Hub footprint, before and after, the process improvement, and how it scales across four functions.',
  },
  {
    file: 'hubspot-automation-catalogue.html',
    slug: 'automation-catalogue',
    title: 'Automation Catalogue',
    blurb: 'Every HubSpot automation capability mapped to a specific job in this system, including the places where the right answer was to leave it manual.',
  },
  {
    file: 'placement-impact-model.html',
    slug: 'impact-model',
    title: 'Impact Model',
    blurb: 'An interactive model of what a placement book is worth and what churn costs. Adjust the inputs; every formula is shown.',
  },
  {
    file: 'zia-hubspot-build-sheet.html',
    slug: 'build-sheet',
    title: 'Build Sheet',
    blurb: 'The implementation order: properties, pipelines, seed data, workflows and dashboards, with tier constraints called out.',
  },
];

/* ── locate the source fragments ────────────────────────────────────── */

function findFragments() {
  const explicit = getArg('--src');
  if (explicit) return explicit;

  // Walk the scratch tree looking for a directory containing the first report.
  const stack = [SRC];
  const seen = new Set();
  while (stack.length) {
    const dir = stack.pop();
    if (seen.has(dir) || !fs.existsSync(dir)) continue;
    seen.add(dir);

    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }

    if (entries.some((e) => e.isFile() && e.name === PAGES[0].file)) return dir;
    for (const e of entries) if (e.isDirectory()) stack.push(path.join(dir, e.name));
  }
  return null;
}

/* ── wrap a fragment into a complete document ───────────────────────── */

function wrap(fragment, fallbackTitle) {
  const titleMatch = fragment.match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : fallbackTitle;
  const body = fragment.replace(/<title>[\s\S]*?<\/title>/i, '').trim();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="color-scheme" content="light dark">
<link rel="icon" href="data:,">
<style>
  /* Minimal reset — the fragment supplies its own design system on top. */
  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; }
  img, svg { max-width: 100%; }
  a { color: inherit; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/* ── index page ─────────────────────────────────────────────────────── */

function buildIndex() {
  const cards = PAGES.map((p) => `      <a class="card" href="/${p.slug}/">
        <h2>${escapeHtml(p.title)}</h2>
        <p>${escapeHtml(p.blurb)}</p>
        <span class="go">Read →</span>
      </a>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HubSpot Systems Analysis — Lumen Talent Group</title>
<meta name="description" content="A complete HubSpot CRM system design for a talent-solutions firm: architecture, automation, reporting and economics.">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="data:,">
<style>
  :root {
    --ground:#F2F3F0; --surface:#FBFBF9; --ink:#171A19; --ink-2:#5D6560; --ink-3:#878F89;
    --rule:#D6D9D3; --rule-firm:#B9BEB7; --accent:#1D5D57;
    --shadow: 0 1px 2px rgba(23,26,25,.06), 0 8px 24px -16px rgba(23,26,25,.28);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground:#121513; --surface:#1A1E1B; --ink:#E9ECE7; --ink-2:#9BA49D; --ink-3:#767E78;
      --rule:#2C312E; --rule-firm:#404742; --accent:#6FBBB1;
      --shadow: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px -16px rgba(0,0,0,.7);
    }
  }
  :root {
    --serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Charter,Georgia,serif;
    --sans:"Segoe UI",-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;
    --mono:ui-monospace,"Cascadia Code",Consolas,"SF Mono",Menlo,monospace;
  }
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ground); color: var(--ink);
    font-family: var(--sans); font-size: 16.5px; line-height: 1.62;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 940px; margin: 0 auto; padding: 0 28px 100px; }
  header { padding: 80px 0 36px; border-bottom: 1px solid var(--rule-firm); }
  .eyebrow {
    font-family: var(--mono); font-size: 11.5px; letter-spacing: .13em;
    text-transform: uppercase; color: var(--accent); margin: 0 0 20px;
  }
  h1 {
    font-family: var(--serif); font-weight: 400;
    font-size: clamp(2.1rem, 5vw, 3.2rem); line-height: 1.07;
    letter-spacing: -.015em; margin: 0 0 18px; text-wrap: balance;
  }
  .standfirst {
    font-family: var(--serif); font-size: 1.18rem; line-height: 1.5;
    color: var(--ink-2); max-width: 56ch; margin: 0 0 26px;
  }
  .credit {
    display: flex; flex-wrap: wrap; gap: 8px 28px;
    font-family: var(--mono); font-size: 12px; color: var(--ink-3);
  }
  .credit b { color: var(--ink-2); font-weight: 500; }
  .intro { max-width: 66ch; margin: 46px 0 0; color: var(--ink-2); }
  .intro b { color: var(--ink); }
  .grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 18px; margin: 40px 0 0;
  }
  .card {
    display: block; text-decoration: none; color: inherit;
    background: var(--surface); border: 1px solid var(--rule);
    padding: 24px 22px 20px; box-shadow: var(--shadow);
    transition: border-color .15s ease, transform .15s ease;
  }
  .card:hover { border-color: var(--accent); transform: translateY(-2px); }
  .card:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .card h2 {
    font-family: var(--serif); font-weight: 400; font-size: 1.35rem;
    margin: 0 0 10px; letter-spacing: -.01em;
  }
  .card p { font-size: 14px; line-height: 1.55; color: var(--ink-2); margin: 0 0 14px; }
  .card .go {
    font-family: var(--mono); font-size: 11px; letter-spacing: .1em;
    text-transform: uppercase; color: var(--accent);
  }
  footer {
    margin-top: 60px; padding-top: 24px; border-top: 1px solid var(--rule);
    font-family: var(--mono); font-size: 11px; color: var(--ink-3); letter-spacing: .04em;
  }
  @media (prefers-reduced-motion: reduce) { .card { transition: none; } }
  @media (max-width: 620px) { .wrap { padding: 0 20px 70px; } header { padding-top: 52px; } }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <p class="eyebrow">HubSpot systems analysis</p>
      <h1>Rebuilding a talent firm's CRM around what it actually delivers</h1>
      <p class="standfirst">A complete HubSpot system design for Lumen Talent Group — covering architecture, automation, marketing operations, reporting and the economics behind it.</p>
      <div class="credit">
        <span><b>Prepared by</b> &nbsp;Salman K.</span>
        <span><b>Client</b> &nbsp;Lumen Talent Group</span>
        <span><b>Five documents</b> &nbsp;design · case study · automation · economics · build</span>
      </div>
    </header>

    <p class="intro">Lumen places embedded remote professionals with client organizations and bills hourly, month after month, often for more than a year. Their CRM recorded the moment a contract was signed and almost nothing afterward — which meant the largest part of the business was invisible to the system meant to manage it. <b>These five documents set out how that was restructured, and what it made possible.</b></p>

    <div class="grid">
${cards}
    </div>

    <footer>HUBSPOT SYSTEMS ANALYSIS · LUMEN TALENT GROUP</footer>
  </div>
</body>
</html>
`;
}

/* ── main ───────────────────────────────────────────────────────────── */

(function main() {
  const src = findFragments();
  if (!src) {
    console.error('\n  Could not locate the report fragments.');
    console.error('  Pass the directory explicitly:\n');
    console.error('    node build-site.js --src "C:/path/to/scratchpad"\n');
    process.exit(1);
  }

  console.log(`\n  Building static site`);
  console.log(`  source: ${src}\n`);

  fs.mkdirSync(OUT, { recursive: true });

  let built = 0;
  for (const page of PAGES) {
    const from = path.join(src, page.file);
    if (!fs.existsSync(from)) {
      console.log(`  !  ${page.slug.padEnd(22)} source missing, skipped`);
      continue;
    }
    const dir = path.join(OUT, page.slug);
    fs.mkdirSync(dir, { recursive: true });
    const html = wrap(fs.readFileSync(from, 'utf8'), page.title);
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    console.log(`  +  ${page.slug.padEnd(22)} ${(html.length / 1024).toFixed(0)} KB`);
    built++;
  }

  fs.writeFileSync(path.join(OUT, 'index.html'), buildIndex());
  console.log(`  +  ${'index'.padEnd(22)} landing page`);

  // Static export with clean URLs — no build step, no framework.
  fs.writeFileSync(path.join(OUT, 'vercel.json'), JSON.stringify({
    cleanUrls: true,
    trailingSlash: true,
  }, null, 2) + '\n');

  console.log(`\n  ${built + 1} pages written to site/`);
  console.log(`\n  Preview locally:   npx serve site`);
  console.log(`  Deploy to Vercel:  cd site && npx vercel --prod\n`);
})();

/* ── util ───────────────────────────────────────────────────────────── */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}
