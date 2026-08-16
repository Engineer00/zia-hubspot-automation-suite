'use strict';
/** Shared helpers for the realism pass. Deterministic: same input -> same output. */

/** FNV-1a string hash -> uint32 */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** mulberry32 PRNG seeded from a string — stable across runs. */
function rng(seed) {
  let a = hash(String(seed));
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller normal. */
function normal(r, mean = 0, sd = 1) {
  const u = Math.max(1e-9, r()), v = Math.max(1e-9, r());
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Log-normal — the shape real sales cycles and deal sizes actually follow. */
function logNormal(r, median, sigma) {
  return median * Math.exp(normal(r, 0, sigma));
}

/** Pick from weighted options: [[value, weight], ...] */
function weighted(r, pairs) {
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let x = r() * total;
  for (const [v, w] of pairs) { if ((x -= w) <= 0) return v; }
  return pairs[pairs.length - 1][0];
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const DAY = 864e5;
const iso = d => new Date(d).toISOString();
const isoDate = d => new Date(d).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY);

/** Nudge a timestamp into business hours on a weekday. */
function businessTime(r, date) {
  const d = new Date(date);
  const day = d.getUTCDay();
  if (day === 0) d.setUTCDate(d.getUTCDate() + 1);
  if (day === 6) d.setUTCDate(d.getUTCDate() + 2);
  d.setUTCHours(int(r, 13, 22), int(r, 0, 59), int(r, 0, 59), 0); // ~9am-6pm US Eastern
  return d;
}

module.exports = { hash, rng, normal, logNormal, weighted, pick, int, clamp, DAY, iso, isoDate, addDays, businessTime };
