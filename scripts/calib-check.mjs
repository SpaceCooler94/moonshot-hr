#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Moonshot — point-in-time calibration-in-the-large (LOCK-ONLY)
//
// Rare-event calibration for 1+ HR props. Brier is useless here (base-rate
// dominated), so this does the honest test: sum of published P(>=1 HR) vs the
// observed count of batters who homered, with an EXACT Poisson-binomial 95%
// band. A night is scored ONLY if it carries a pre-first-pitch lock marker;
// rebuilt / un-locked nights are excluded (they leak same-day Statcast into
// their own features and are not point-in-time).
//
// No dependencies. Deterministic. Node 18+.
//
//   node scripts/calib-check.mjs [startDate] [endDate]
//     dates optional, inclusive, YYYY-MM-DD.
//
// ===========================================================================
// EDIT HERE if your walk-forward JSON uses different field names.
// These six accessors are the ONLY things tied to your schema.
// ===========================================================================

// 1) A parsed walk file -> array of day objects.
function daysFromFile(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.days)) return parsed.days;
  if (parsed && typeof parsed === 'object') return Object.values(parsed);
  return [];
}
// 2) day -> ISO date 'YYYY-MM-DD' (or null if unknown).
function dayDate(day) {
  return day?.date ?? day?.dueDate ?? day?.d ?? null;
}
// 3) day -> array of per-batter prediction records.
function dayRecords(day) {
  return day?.looks ?? day?.predictions ?? day?.preds ?? day?.batters ?? [];
}
// 4) record -> published P(>=1 HR), a number in [0,1] (or null if absent).
function recP(rec) {
  const v = rec?.pHr ?? rec?.pHR ?? rec?.p ?? rec?.prob ?? null;
  return typeof v === 'number' ? v : null;
}
// 5) record -> outcome: 1 if the batter hit >=1 HR, else 0 (or null if ungraded).
function recY(rec) {
  const v = rec?.y ?? rec?.hr ?? rec?.homered ?? rec?.result ?? null;
  if (v === true) return 1;
  if (v === false) return 0;
  if (typeof v === 'number') return v > 0 ? 1 : 0;
  return null;
}
// 6) Lock marker. A night is counted ONLY if this returns true (either an
//    inline flag on the day, or a matching file in data/walk/locks/).
function nightLocked(day, dateStr, lockSet) {
  return day?.locked === true
      || day?.lockedAt != null
      || day?.lock === true
      || typeof day?.lockFile === 'string'
      || (dateStr != null && lockSet.has(dateStr));
}

// ===========================================================================
// Below this line is schema-independent. No need to edit.
// ===========================================================================

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const WALK_DIR = 'data/walk';
const PB_EXACT_MAX = 20000; // above this many records, use normal-approx band

const BANDS = [
  ['<0.08',    -Infinity, 0.08],
  ['0.08-0.12', 0.08,     0.12],
  ['0.12-0.16', 0.12,     0.16],
  ['0.16-0.22', 0.16,     0.22],
  ['>0.22',     0.22,     Infinity],
];

// --- Poisson-binomial: exact PMF over 0..n via convolution -----------------
function poissonBinomialPMF(ps) {
  let pmf = [1];
  for (const p of ps) {
    const next = new Array(pmf.length + 1).fill(0);
    for (let k = 0; k < pmf.length; k++) {
      next[k]     += pmf[k] * (1 - p);
      next[k + 1] += pmf[k] * p;
    }
    pmf = next;
  }
  return pmf;
}
function pbBand(pmf, lo = 0.025, hi = 0.975) {
  let cum = 0, loK = 0, hiK = pmf.length - 1, foundLo = false;
  for (let k = 0; k < pmf.length; k++) {
    cum += pmf[k];
    if (!foundLo && cum >= lo) { loK = k; foundLo = true; }
    if (cum >= hi) { hiK = k; break; }
  }
  return [loK, hiK];
}
function pbTwoSided(pmf, obs) {
  let leq = 0, geq = 0;
  for (let k = 0; k < pmf.length; k++) {
    if (k <= obs) leq += pmf[k];
    if (k >= obs) geq += pmf[k];
  }
  return Math.min(1, 2 * Math.min(leq, geq));
}

// --- one calibration slice --------------------------------------------------
function slice(ps, ys) {
  const n = ps.length;
  const sumP = ps.reduce((a, p) => a + p, 0);
  const obs  = ys.reduce((a, y) => a + y, 0);
  const varP = ps.reduce((a, p) => a + p * (1 - p), 0);
  const sd   = Math.sqrt(varP);
  const z    = sd > 0 ? (obs - sumP) / sd : 0;

  let band, exactP, method;
  if (n > 0 && n <= PB_EXACT_MAX) {
    const pmf = poissonBinomialPMF(ps);
    band   = pbBand(pmf);
    exactP = pbTwoSided(pmf, obs);
    method = 'exact';
  } else {
    band   = [Math.round(sumP - 1.96 * sd), Math.round(sumP + 1.96 * sd)];
    exactP = null;
    method = 'normal';
  }
  const inside = obs >= band[0] && obs <= band[1];
  return { n, sumP, obs, sd, z, band, exactP, inside, method,
           meanP: n ? sumP / n : 0, rate: n ? obs / n : 0 };
}

// --- formatting -------------------------------------------------------------
const f = (x, d = 2) => Number(x).toFixed(d);
const padL = (s, w) => String(s).padStart(w);
const padR = (s, w) => String(s).padEnd(w);

async function loadLockSet(dir) {
  try {
    const entries = await readdir(join(dir, 'locks'), { withFileTypes: true });
    return new Set(entries.filter(e => e.isFile() && e.name.endsWith('.json'))
                          .map(e => e.name.replace(/\.json$/, '')));
  } catch { return new Set(); }
}

async function main() {
  const [start, end] = process.argv.slice(2);
  const inRange = (d) => {
    if (start && (d == null || d < start)) return false;
    if (end   && (d == null || d > end))   return false;
    return true;
  };

  let entries;
  try {
    entries = await readdir(WALK_DIR, { withFileTypes: true });
  } catch {
    console.error(`No ${WALK_DIR}/ directory. Run from the repo root.`);
    process.exit(1);
  }
  const files = entries.filter(e => e.isFile() && e.name.endsWith('.json'))
                       .map(e => e.name);
  const lockSet = await loadLockSet(WALK_DIR);

  const ps = [], ys = [];
  let lockedNights = 0, excludedNights = 0, skippedRecs = 0;
  let minD = null, maxD = null;

  for (const file of files) {
    let parsed;
    try { parsed = JSON.parse(await readFile(join(WALK_DIR, file), 'utf8')); }
    catch { continue; }
    for (const day of daysFromFile(parsed)) {
      const d = dayDate(day);
      if (!inRange(d)) continue;
      if (!nightLocked(day, d, lockSet)) { excludedNights++; continue; }
      lockedNights++;
      if (d != null) { if (minD == null || d < minD) minD = d;
                       if (maxD == null || d > maxD) maxD = d; }
      for (const rec of dayRecords(day)) {
        const p = recP(rec), y = recY(rec);
        if (p == null || y == null || !(p >= 0 && p <= 1)) { skippedRecs++; continue; }
        ps.push(p); ys.push(y);
      }
    }
  }

  if (lockedNights === 0) {
    console.error(
`No locked nights found.

nightLocked() matched nothing — either your walk data predates locking, or the
lock marker is a different field / location. Scoring un-locked nights would
reintroduce the same-day-Statcast leak this check exists to exclude, so nothing
was scored. Point accessor #6 (or data/walk/locks/) at your lock signal and
re-run.`);
    process.exit(1);
  }
  if (ps.length === 0) {
    console.error(`Found ${lockedNights} locked night(s) but 0 graded records ` +
                  `(missing P or outcome). Nothing to score.`);
    process.exit(1);
  }

  const agg = slice(ps, ys);

  console.log(`\nMoonshot — point-in-time calibration-in-the-large (lock-only)`);
  console.log(`Window:  ${minD ?? '?'} … ${maxD ?? '?'}`);
  console.log(`Nights:  ${lockedNights} locked | ${excludedNights} excluded ` +
              `(no lock marker — leaked/rebuilt, not scored)`);
  console.log(`Records: ${ps.length} scored | ${skippedRecs} skipped ` +
              `(missing P or outcome)\n`);

  console.log(`AGGREGATE`);
  console.log(`  n                    ${agg.n}`);
  console.log(`  mean P(>=1 HR)       ${f(agg.meanP, 4)}`);
  console.log(`  expected HRs (sum P) ${f(agg.sumP, 1)}`);
  console.log(`  observed HRs         ${agg.obs}`);
  console.log(`  observed rate        ${f(agg.rate, 4)}`);
  console.log(`  Poisson-binomial SD  ${f(agg.sd, 1)}`);
  console.log(`  95% band (${agg.method})    [${agg.band[0]}, ${agg.band[1]}]`);
  console.log(`  observed ${agg.obs}          ${agg.inside ? 'INSIDE' : 'OUTSIDE'}` +
              (agg.exactP != null ? `   two-sided p ${f(agg.exactP, 3)}` : ''));
  console.log(`  normal-approx z      ${agg.z >= 0 ? '+' : ''}${f(agg.z, 2)}\n`);

  console.log(`BY PROBABILITY BAND`);
  console.log(`  ${padR('band', 11)}${padL('n', 6)}  ${padL('meanP', 6)}  ` +
              `${padL('expHR', 7)}  ${padL('obsHR', 6)}  ${padR('95% band', 12)}` +
              `  ${padR('', 3)}  ${padL('z', 6)}`);
  for (const [name, lo, hi] of BANDS) {
    const bp = [], by = [];
    for (let i = 0; i < ps.length; i++) {
      if (ps[i] >= lo && ps[i] < hi) { bp.push(ps[i]); by.push(ys[i]); }
    }
    if (bp.length === 0) {
      console.log(`  ${padR(name, 11)}${padL(0, 6)}`);
      continue;
    }
    const s = slice(bp, by);
    const bandStr = `[${padL(s.band[0], 3)},${padL(s.band[1], 4)}]`;
    console.log(
      `  ${padR(name, 11)}${padL(s.n, 6)}  ${padL(f(s.meanP, 3), 6)}  ` +
      `${padL(f(s.sumP, 1), 7)}  ${padL(s.obs, 6)}  ${padR(bandStr, 12)}` +
      `  ${padR(s.inside ? 'IN' : 'OUT', 3)}  ${padL((s.z >= 0 ? '+' : '') + f(s.z, 2), 6)}`);
  }
  console.log('');
}

main();
