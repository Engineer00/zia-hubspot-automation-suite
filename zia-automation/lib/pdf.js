'use strict';
/**
 * Minimal PDF writer — no dependencies.
 *
 * PDF is a plain-text container, so a one-page business document needs nothing
 * more than the base-14 Helvetica fonts every reader ships with. Enough for
 * SOWs, consultant profiles, compliance certificates and QBR summaries.
 *
 * ASCII only: the base fonts use WinAnsi encoding and this writer does not
 * embed a glyph map, so smart quotes and em-dashes are transliterated.
 */

const PAGE_W = 612, PAGE_H = 792;   // US Letter, 72dpi
const MARGIN = 56;

const asciify = s => String(s)
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/[–—]/g, '-')
  .replace(/•/g, '-')
  .replace(/[^\x20-\x7E]/g, '');

const esc = s => asciify(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Helvetica advance widths (1/1000 em) for the printable ASCII range. */
const W = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const widthOf = (ch, size, bold) => {
  const c = ch.charCodeAt(0);
  const w = c >= 32 && c <= 126 ? W[c - 32] : 556;
  return (w * (bold ? 1.06 : 1)) * size / 1000;
};
const textWidth = (s, size, bold) => asciify(s).split('').reduce((a, c) => a + widthOf(c, size, bold), 0);

/** Greedy wrap to a pixel width. */
function wrap(text, size, bold, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const probe = line ? line + ' ' + word : word;
      if (textWidth(probe, size, bold) > maxW && line) { out.push(line); line = word; }
      else line = probe;
    }
    out.push(line);
  }
  return out;
}

/**
 * Build a one-page document.
 *
 * blocks: [{ type, ... }]
 *   { type:'title',  text }
 *   { type:'meta',   text }                  small grey line under the title
 *   { type:'h',      text }                  section heading
 *   { type:'p',      text }
 *   { type:'kv',     rows:[[label,value]] }  two-column facts table
 *   { type:'rule' }
 *   { type:'space',  h }
 *   { type:'sign',   name, role }            signature block
 */
function buildPdf({ blocks, footer = '' }) {
  const ops = [];
  let y = PAGE_H - MARGIN;
  const maxW = PAGE_W - MARGIN * 2;

  const gray = v => ops.push(`${v} ${v} ${v} rg`);
  const text = (s, x, yy, size, bold) => {
    ops.push('BT', `/${bold ? 'F2' : 'F1'} ${size} Tf`, `1 0 0 1 ${x.toFixed(2)} ${yy.toFixed(2)} Tm`, `(${esc(s)}) Tj`, 'ET');
  };

  for (const b of blocks) {
    if (y < MARGIN + 60 && b.type !== 'sign') break;   // one page, by design

    switch (b.type) {
      case 'title':
        gray(0.05); y -= 24; text(b.text, MARGIN, y, 19, true); y -= 6;
        break;
      case 'meta':
        gray(0.45); y -= 14; text(b.text, MARGIN, y, 9, false); y -= 4;
        break;
      case 'h':
        gray(0.05); y -= 26; text(b.text.toUpperCase(), MARGIN, y, 9.5, true); y -= 6;
        gray(0.8); ops.push(`${MARGIN} ${y.toFixed(2)} m ${(PAGE_W - MARGIN).toFixed(2)} ${y.toFixed(2)} l 0.6 w S`);
        y -= 6;
        break;
      case 'p':
        gray(0.15); y -= 8;
        for (const line of wrap(b.text, 10, false, maxW)) { y -= 13.5; text(line, MARGIN, y, 10, false); }
        break;
      case 'kv':
        y -= 6;
        for (const [k, v] of b.rows) {
          y -= 16;
          gray(0.45); text(k, MARGIN, y, 9, false);
          gray(0.05); text(String(v), MARGIN + 168, y, 10, true);
        }
        break;
      case 'rule':
        y -= 12; gray(0.85);
        ops.push(`${MARGIN} ${y.toFixed(2)} m ${(PAGE_W - MARGIN).toFixed(2)} ${y.toFixed(2)} l 0.6 w S`);
        break;
      case 'space':
        y -= (b.h || 10);
        break;
      case 'sign':
        y -= 46; gray(0.75);
        ops.push(`${MARGIN} ${y.toFixed(2)} m ${(MARGIN + 210).toFixed(2)} ${y.toFixed(2)} l 0.6 w S`);
        y -= 13; gray(0.15); text(b.name, MARGIN, y, 10, true);
        y -= 12; gray(0.45); text(b.role, MARGIN, y, 8.5, false);
        break;
    }
  }

  if (footer) { gray(0.55); text(footer, MARGIN, MARGIN - 16, 7.5, false); }

  const stream = ops.join('\n');

  // ---- assemble objects ----
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${PAGE_W} ${PAGE_H}]`
      + '/Resources<</Font<</F1 5 0 R/F2 6 0 R>>>>/Contents 4 0 R>>',
    `<</Length ${Buffer.byteLength(stream)}>>\nstream\n${stream}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += String(off).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}

module.exports = { buildPdf };
