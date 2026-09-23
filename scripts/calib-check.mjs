#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// --- edit these six to match the real walk schema; keep everything else ---
function daysFromFile(p) {
  if (Array.isArray(p)) return p;
  if (Array.isArray(p?.days)) return p.days;
  if (p && typeof p === "object") return Object.values(p);
  return [];
}
function dayDate(d) {
  return d?.date ?? d?.dueDate ?? d?.d ?? null;
}
function dayRecords(d) {
  return d?.looks ?? d?.predictions ?? d?.preds ?? d?.batters ?? [];
}
function recP(r) {
  const v = r?.pHr ?? r?.pHR ?? r?.p ?? r?.prob ?? null;
  return typeof v === "number" ? v : null;
}
function recY(r) {
  const v = r?.y ?? r?.hr ?? r?.homered ?? r?.result ?? null;
  if (v === true) return 1;
  if (v === false) return 0;
  if (typeof v === "number") return v > 0 ? 1 : 0;
  return null;
}
function nightLocked(d, ds, ls) {
  return (
    d?.lockStatus === "locked" ||
    d?.locked === true ||
    d?.lockedAt != null ||
    d?.lock === true ||
    typeof d?.lockFile === "string" ||
    (ds != null && ls.has(ds))
  );
}
// --------------------------------------------------------------------------

const WALK_DIR = "data/walk";
const LOCK_DIR = "data/locks";
const PB_EXACT_MAX = 20000;
const BANDS = [
  ["<0.08", -Infinity, 0.08],
  ["0.08-0.12", 0.08, 0.12],
  ["0.12-0.16", 0.12, 0.16],
  ["0.16-0.22", 0.16, 0.22],
  [">0.22", 0.22, Infinity],
];

function pbPMF(ps) {
  let pmf = [1];
  for (const p of ps) {
    const n = new Array(pmf.length + 1).fill(0);
    for (let k = 0; k < pmf.length; k++) {
      n[k] += pmf[k] * (1 - p);
      n[k + 1] += pmf[k] * p;
    }
    pmf = n;
  }
  return pmf;
}
function pbBand(pmf, lo = 0.025, hi = 0.975) {
  let c = 0,
    loK = 0,
    hiK = pmf.length - 1,
    f = false;
  for (let k = 0; k < pmf.length; k++) {
    c += pmf[k];
    if (!f && c >= lo) {
      loK = k;
      f = true;
    }
    if (c >= hi) {
      hiK = k;
      break;
    }
  }
  return [loK, hiK];
}
function pbTwoSided(pmf, o) {
  let le = 0,
    ge = 0;
  for (let k = 0; k < pmf.length; k++) {
    if (k <= o) le += pmf[k];
    if (k >= o) ge += pmf[k];
  }
  return Math.min(1, 2 * Math.min(le, ge));
}
function slice(ps, ys) {
  const n = ps.length,
    sumP = ps.reduce((a, p) => a + p, 0),
    obs = ys.reduce((a, y) => a + y, 0),
    varP = ps.reduce((a, p) => a + p * (1 - p), 0),
    sd = Math.sqrt(varP),
    z = sd > 0 ? (obs - sumP) / sd : 0;
  let band, ep, m;
  if (n > 0 && n <= PB_EXACT_MAX) {
    const pmf = pbPMF(ps);
    band = pbBand(pmf);
    ep = pbTwoSided(pmf, obs);
    m = "exact";
  } else {
    band = [Math.round(sumP - 1.96 * sd), Math.round(sumP + 1.96 * sd)];
    ep = null;
    m = "normal";
  }
  return {
    n,
    sumP,
    obs,
    sd,
    z,
    band,
    ep,
    inside: obs >= band[0] && obs <= band[1],
    m,
    meanP: n ? sumP / n : 0,
    rate: n ? obs / n : 0,
  };
}
const f = (x, d = 2) => Number(x).toFixed(d);
const pL = (s, w) => String(s).padStart(w);
const pR = (s, w) => String(s).padEnd(w);

async function lockSet(dir) {
  const s = new Set();
  const lockP = new Map();
  async function ingestFile(path) {
    let raw;
    try {
      raw = JSON.parse(await readFile(path, "utf8"));
    } catch {
      return;
    }
    const recs = Array.isArray(raw) ? raw : daysFromFile(raw);
    for (const r of recs) {
      if (typeof r?.date !== "string") continue;
      if (r.lockedAt != null || r.lockStatus === "locked" || Array.isArray(r.looks)) {
        if (r.lockedAt != null || r.model) s.add(r.date);
      }
      if (!Array.isArray(r.looks) || r.lockedAt == null) continue;
      const m = lockP.get(r.date) ?? new Map();
      for (const look of r.looks) {
        if (!Number.isFinite(look?.playerId) || !Number.isFinite(look?.gamePk)) continue;
        if (typeof look.pHr !== "number") continue;
        m.set(`${look.playerId}:${look.gamePk}`, look.pHr);
      }
      if (m.size) {
        lockP.set(r.date, m);
        s.add(r.date);
      }
    }
  }
  try {
    const e = await readdir(join(dir, "locks"), { withFileTypes: true });
    for (const x of e.filter((x) => x.isFile() && x.name.endsWith(".json"))) {
      const stem = x.name.replace(/\.json$/, "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(stem)) s.add(stem);
      await ingestFile(join(dir, "locks", x.name));
    }
  } catch {
    /* no data/walk/locks */
  }
  try {
    const e = await readdir(LOCK_DIR, { withFileTypes: true });
    for (const x of e.filter((x) => x.isFile() && x.name.endsWith(".json"))) {
      await ingestFile(join(LOCK_DIR, x.name));
    }
  } catch {
    /* no data/locks */
  }
  s.lockP = lockP;
  return s;
}

async function main() {
  const [start, end] = process.argv.slice(2);
  const inR = (d) => {
    if (start && (d == null || d < start)) return false;
    if (end && (d == null || d > end)) return false;
    return true;
  };
  let entries;
  try {
    entries = await readdir(WALK_DIR, { withFileTypes: true });
  } catch {
    console.error(`No ${WALK_DIR}/ dir. Run from repo root.`);
    process.exit(1);
  }
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name);
  const ls = await lockSet(WALK_DIR);
  const lockP = ls.lockP ?? new Map();
  const byDate = new Map();
  for (const file of files) {
    let p;
    try {
      p = JSON.parse(await readFile(join(WALK_DIR, file), "utf8"));
    } catch {
      continue;
    }
    for (const day of daysFromFile(p)) {
      const d = dayDate(day);
      if (!inR(d) || d == null) continue;
      const prev = byDate.get(d);
      if (!prev || (nightLocked(day, d, ls) && !nightLocked(prev, d, ls))) byDate.set(d, day);
    }
  }
  const ps = [],
    ys = [];
  let locked = 0,
    excl = 0,
    skip = 0,
    minD = null,
    maxD = null;
  for (const [d, day] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!nightLocked(day, d, ls)) {
      excl++;
      continue;
    }
    locked++;
    if (d != null) {
      if (minD == null || d < minD) minD = d;
      if (maxD == null || d > maxD) maxD = d;
    }
    const frozen = lockP.get(d);
    for (const rec of dayRecords(day)) {
      const y = recY(rec);
      const id =
        Number.isFinite(rec?.playerId) && Number.isFinite(rec?.gamePk)
          ? `${rec.playerId}:${rec.gamePk}`
          : null;
      const pp = (id && frozen?.get(id)) ?? recP(rec);
      if (frozen && id && !frozen.has(id)) {
        skip++;
        continue;
      }
      if (pp == null || y == null || !(pp >= 0 && pp <= 1)) {
        skip++;
        continue;
      }
      ps.push(pp);
      ys.push(y);
    }
  }
  if (locked === 0) {
    console.error(
      `0 locked nights. nightLocked() matched nothing — scoring un-locked nights would reintroduce the leak this check exists to exclude, so nothing was scored. Point accessor #6 (or data/walk/locks/) at the lock signal and re-run.`,
    );
    process.exit(1);
  }
  if (ps.length === 0) {
    console.error(`${locked} locked night(s), 0 graded records (missing P or outcome).`);
    process.exit(1);
  }
  const a = slice(ps, ys);
  console.log(`\nMoonshot — point-in-time calibration-in-the-large (lock-only)`);
  console.log(`Window:  ${minD ?? "?"} … ${maxD ?? "?"}`);
  console.log(`Nights:  ${locked} locked | ${excl} excluded (no lock marker — leaked/rebuilt, not scored)`);
  console.log(`Records: ${ps.length} scored | ${skip} skipped (missing P or outcome)\n`);
  console.log(`AGGREGATE`);
  console.log(`  n                    ${a.n}`);
  console.log(`  mean P(>=1 HR)       ${f(a.meanP, 4)}`);
  console.log(`  expected HRs (sum P) ${f(a.sumP, 1)}`);
  console.log(`  observed HRs         ${a.obs}`);
  console.log(`  observed rate        ${f(a.rate, 4)}`);
  console.log(`  Poisson-binomial SD  ${f(a.sd, 1)}`);
  console.log(`  95% band (${a.m})    [${a.band[0]}, ${a.band[1]}]`);
  console.log(
    `  observed ${a.obs}          ${a.inside ? "INSIDE" : "OUTSIDE"}` +
      (a.ep != null ? `   two-sided p ${f(a.ep, 3)}` : ""),
  );
  console.log(`  normal-approx z      ${a.z >= 0 ? "+" : ""}${f(a.z, 2)}\n`);
  console.log(`BY PROBABILITY BAND`);
  console.log(
    `  ${pR("band", 11)}${pL("n", 6)}  ${pL("meanP", 6)}  ${pL("expHR", 7)}  ${pL("obsHR", 6)}  ${pR("95% band", 12)}  ${pR("", 3)}  ${pL("z", 6)}`,
  );
  for (const [name, lo, hi] of BANDS) {
    const bp = [],
      by = [];
    for (let i = 0; i < ps.length; i++) {
      if (ps[i] >= lo && ps[i] < hi) {
        bp.push(ps[i]);
        by.push(ys[i]);
      }
    }
    if (bp.length === 0) {
      console.log(`  ${pR(name, 11)}${pL(0, 6)}`);
      continue;
    }
    const s = slice(bp, by),
      b = `[${pL(s.band[0], 3)},${pL(s.band[1], 4)}]`;
    console.log(
      `  ${pR(name, 11)}${pL(s.n, 6)}  ${pL(f(s.meanP, 3), 6)}  ${pL(f(s.sumP, 1), 7)}  ${pL(s.obs, 6)}  ${pR(b, 12)}  ${pR(s.inside ? "IN" : "OUT", 3)}  ${pL((s.z >= 0 ? "+" : "") + f(s.z, 2), 6)}`,
    );
  }
  console.log("");
}
main();
