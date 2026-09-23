#!/usr/bin/env node
/**
 * Walk-forward HR logistic. Train on past season, calibrate on a held-out
 * date slice, test on the next season. Writes data/model/current.json.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { applyStandardizer, brier, fitLogit, fitStandardizer, logLoss, predictP } from "../src/lib/mlb/logit.ts";
import { applyIsotonic, cutFromRate, deciles, fitIsotonic } from "../src/lib/mlb/isotonic.ts";
import { FEATURES, featureRecord, lgDefault, toRow, type BatterPrior, type GameLog, type PitcherPrior } from "../src/lib/mlb/hr-features.ts";
import { LOGIT_VERSION, type HrArtifact, type HrCuts } from "../src/lib/mlb/hr-model.ts";
import { fetchSavant } from "../src/lib/mlb/savant.ts";

const ROOT = join(import.meta.dirname, "..");
const DIR = join(ROOT, "data", "train");
const MODEL_DIR = join(ROOT, "data", "model");
const MLB = "https://statsapi.mlb.com/api/v1";

type Person = { bats: "L" | "R" | "S"; throws: "L" | "R" | "S" };
type BoxBat = {
  id: number;
  order: number;
  hr: number;
  ab: number;
  pa: number;
  doubles: number;
  triples: number;
  isHome: boolean;
};
type BoxGame = {
  pk: number;
  date: string;
  venueId: number;
  temp: number | null;
  windOut: number | null;
  awaySp: number | null;
  homeSp: number | null;
  awayBf: number;
  homeBf: number;
  awayHr: number;
  homeHr: number;
  bats: BoxBat[];
};

function loadJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function getJson(path: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${MLB}${path}`, {
      headers: { Accept: "application/json", "User-Agent": "moonshot-hr/train" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseWind(w: string | null): number {
  if (!w) return 0;
  const mph = Number(/(\d+)\s*mph/i.exec(w)?.[1] ?? 0);
  if (!mph) return 0;
  const low = w.toLowerCase();
  if (low.includes("out")) return mph;
  if (/\bin\b/.test(low)) return -mph;
  return 0;
}

function orderOf(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(9, Math.max(1, Math.floor(n / 100) || n));
}

async function people(season: number): Promise<Map<number, Person>> {
  const path = join(DIR, `people-${season}.json`);
  const cached = loadJson<Record<string, Person>>(path, {});
  if (Object.keys(cached).length > 500) {
    return new Map(Object.entries(cached).map(([k, v]) => [Number(k), v]));
  }
  const raw = asRec(await getJson(`/sports/1/players?season=${season}`));
  const list = Array.isArray(raw?.people) ? raw.people : [];
  const map: Record<string, Person> = {};
  for (const p of list) {
    const rec = asRec(p);
    if (!rec) continue;
    const id = num(rec.id);
    if (!id) continue;
    const bats = asRec(rec.batSide)?.code;
    const th = asRec(rec.pitchHand)?.code;
    map[String(id)] = {
      bats: bats === "L" || bats === "S" ? bats : "R",
      throws: th === "L" || th === "S" ? th : "R",
    };
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(map));
  return new Map(Object.entries(map).map(([k, v]) => [Number(k), v]));
}

async function gamePks(season: number): Promise<Array<{ pk: number; date: string; venueId: number; temp: number | null; windOut: number | null }>> {
  const path = join(DIR, `sked-${season}.json`);
  const cached = loadJson<Array<{ pk: number; date: string; venueId: number; temp: number | null; windOut: number | null }>>(path, []);
  if (cached.length > 100 && cached[0] && "venueId" in cached[0]) return cached;
  const raw = asRec(await getJson(`/schedule?sportId=1&season=${season}&gameTypes=R&hydrate=weather,venue`));
  const dates = Array.isArray(raw?.dates) ? raw.dates : [];
  const out: Array<{ pk: number; date: string; venueId: number; temp: number | null; windOut: number | null }> = [];
  for (const d of dates) {
    const rec = asRec(d);
    const date = typeof rec?.date === "string" ? rec.date : "";
    const games = Array.isArray(rec?.games) ? rec.games : [];
    for (const g of games) {
      const gr = asRec(g);
      const st = asRec(gr?.status)?.abstractGameState;
      if (st && st !== "Final") continue;
      const pk = num(gr?.gamePk);
      if (!pk || !date) continue;
      const venueId = num(asRec(gr?.venue)?.id);
      const w = asRec(gr?.weather);
      const temp = w?.temp != null ? Number(w.temp) : null;
      out.push({
        pk,
        date,
        venueId,
        temp: Number.isFinite(temp) ? temp : null,
        windOut: parseWind(typeof w?.wind === "string" ? w.wind : null),
      });
    }
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(out));
  return out;
}

function parseBox(pk: number, date: string, raw: unknown): BoxGame | null {
  const rec = asRec(raw);
  const teams = asRec(rec?.teams);
  if (!teams) return null;
  const pull = (side: "away" | "home") => {
    const t = asRec(teams[side]);
    const players = asRec(t?.players) ?? {};
    const bats: BoxBat[] = [];
    for (const p of Object.values(players)) {
      const pr = asRec(p);
      if (!pr) continue;
      const order = orderOf(pr.battingOrder);
      const st = asRec(asRec(pr.stats)?.batting);
      if (!order || !st) continue;
      const pa = num(st.plateAppearances);
      if (pa <= 0) continue;
      bats.push({
        id: num(asRec(pr.person)?.id),
        order,
        hr: num(st.homeRuns),
        ab: num(st.atBats),
        pa,
        doubles: num(st.doubles),
        triples: num(st.triples),
        isHome: side === "home",
      });
    }
    const pids = Array.isArray(t?.pitchers) ? t.pitchers.map(num) : [];
    let sp: number | null = null;
    let bf = 0;
    let hr = 0;
    for (const id of pids) {
      const pr = asRec(players[`ID${id}`]);
      const pit = asRec(asRec(pr?.stats)?.pitching);
      if (!pit) continue;
      if (sp == null && num(pit.gamesStarted) >= 1) sp = id;
      if (id === sp || (sp == null && pids[0] === id)) {
        if (sp == null) sp = id;
        bf = num(pit.battersFaced);
        hr = num(pit.homeRuns);
      }
    }
    if (sp == null && pids[0]) sp = pids[0];
    return { bats, sp, bf, hr };
  };
  const away = pull("away");
  const home = pull("home");
  return {
    pk,
    date,
    venueId: 0,
    temp: null,
    windOut: null,
    awaySp: away.sp,
    homeSp: home.sp,
    awayBf: away.bf,
    homeBf: home.bf,
    awayHr: away.hr,
    homeHr: home.hr,
    bats: [...away.bats, ...home.bats],
  };
}

async function loadBox(g: { pk: number; date: string; venueId: number; temp: number | null; windOut: number | null }): Promise<BoxGame | null> {
  const path = join(DIR, "box", `${g.pk}.json`);
  if (existsSync(path)) {
    const hit = loadJson<BoxGame | null>(path, null);
    if (hit) {
      hit.venueId = hit.venueId || g.venueId;
      hit.temp = hit.temp ?? g.temp;
      hit.windOut = hit.windOut ?? g.windOut;
    }
    return hit;
  }
  try {
    const raw = await getJson(`/game/${g.pk}/boxscore`);
    const box = parseBox(g.pk, g.date, raw);
    if (box) {
      box.venueId = g.venueId;
      box.temp = g.temp;
      box.windOut = g.windOut;
    }
    mkdirSync(join(DIR, "box"), { recursive: true });
    writeFileSync(path, JSON.stringify(box));
    return box;
  } catch {
    mkdirSync(join(DIR, "box"), { recursive: true });
    writeFileSync(path, "null");
    return null;
  }
}

async function pitcherHr9(season: number): Promise<Map<number, number>> {
  const path = join(DIR, `p-hr9-${season}.json`);
  const cached = loadJson<Record<string, number>>(path, {});
  if (Object.keys(cached).length > 100) return new Map(Object.entries(cached).map(([k, v]) => [Number(k), v]));
  const raw = asRec(await getJson(`/stats?group=pitching&stats=season&season=${season}&sportIds=1&limit=1000&gameTypes=R`));
  const stats = Array.isArray(raw?.stats) ? raw.stats : [];
  const splits = Array.isArray(asRec(stats[0])?.splits) ? (asRec(stats[0])!.splits as unknown[]) : [];
  const map: Record<string, number> = {};
  for (const s of splits) {
    const rec = asRec(s);
    const id = num(asRec(rec?.player)?.id);
    const hr9 = num(asRec(rec?.stat)?.homeRunsPer9);
    if (id && hr9 >= 0) map[String(id)] = hr9;
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(map));
  return new Map(Object.entries(map).map(([k, v]) => [Number(k), v]));
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const k = i++;
      await fn(items[k]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()));
}

function isoOf(b: BoxBat): number {
  if (b.ab <= 0) return 0;
  return (b.doubles + 2 * b.triples + 3 * b.hr) / b.ab;
}

function metrics(ps: number[], y: number[]) {
  const n = y.length;
  const base = n ? y.reduce((s, v) => s + v, 0) / n : 0;
  return { n, brier: n ? brier(ps, y) : 0, logloss: n ? logLoss(ps, y) : 0, base, deciles: n ? deciles(ps, y, 10) : [] };
}

function pickCuts(ps: number[], y: number[], dates: string[]): HrCuts {
  const base = y.reduce((s, v) => s + v, 0) / Math.max(1, y.length);
  const bins = deciles(ps, y, 10);
  const top = bins[bins.length - 1];
  const look = top?.lo ?? 1;
  const lookRate = top?.actual ?? base;
  const watchBin = [...bins].reverse().find((b) => b.actual < base);
  const watch = watchBin ? watchBin.hi : bins[4]?.lo ?? look;
  const nights = new Set(dates).size || 1;
  const looks = ps.filter((p) => p >= look).length;
  let cap: number | null = null;
  let capWhy = "Calibrated top bin is inside 3pts of observed — no cap.";
  if (top && top.meanP - top.actual > 0.03) {
    cap = top.actual + 0.02;
    capWhy = `Top decile meanP ${top.meanP.toFixed(3)} vs actual ${top.actual.toFixed(3)}; cap at ${cap.toFixed(3)}.`;
  }
  return {
    look,
    watch: Math.min(watch, look),
    lookRate,
    looksPerNight: looks / nights,
    cap,
    capWhy,
  };
}

async function main() {
  mkdirSync(DIR, { recursive: true });
  mkdirSync(MODEL_DIR, { recursive: true });
  const testSeason = 2026;
  const trainSeason = 2025;
  const priorSeason = 2024;

  console.log("people + savant + schedule");
  const [who, savantPrior, savantTrain, skedTrain, skedTest, hr9Prior, hr9Train] = await Promise.all([
    people(trainSeason).then(async (a) => {
      const b = await people(testSeason);
      return new Map([...a, ...b]);
    }),
    fetchSavant(priorSeason),
    fetchSavant(trainSeason),
    gamePks(trainSeason),
    gamePks(testSeason),
    pitcherHr9(priorSeason),
    pitcherHr9(trainSeason),
  ]);

  const games = [...skedTrain, ...skedTest];
  console.log(`boxscores ${games.length}`);
  let done = 0;
  await pool(games, 6, async (g) => {
    await loadBox(g);
    done++;
    if (done % 200 === 0) console.log(`  ${done}/${games.length}`);
  });

  const batterPrior = new Map<number, BatterPrior>();
  const pitcherPrior = new Map<number, PitcherPrior>();
  for (const [id, b] of savantPrior.batters) {
    const pull = b.pull ?? 40;
    const fb = b.flyBall ?? 25;
    batterPrior.set(id, {
      iso: b.xIso ?? 0.15,
      barrel: b.barrel ?? 8,
      hardhit: b.hardHit ?? 40,
      ev: b.ev ?? 89,
      pullair: (pull * fb) / 100,
      xiso: b.xIso ?? 0.15,
      vsL: null,
      vsR: null,
    });
  }
  for (const [id, p] of savantPrior.pitchers) {
    pitcherPrior.set(id, {
      hr9: hr9Prior.get(id) ?? (p.xIso != null ? p.xIso * 18 : 1.15),
      barrel: p.barrel ?? 8,
      fb: p.flyBall ?? 36,
      ev: p.ev ?? 89,
    });
  }
  // 2025 savant is the prior for 2026 games only — attached later by date.
  const prior2025B = new Map<number, BatterPrior>();
  const prior2025P = new Map<number, PitcherPrior>();
  for (const [id, b] of savantTrain.batters) {
    const pull = b.pull ?? 40;
    const fb = b.flyBall ?? 25;
    prior2025B.set(id, {
      iso: b.xIso ?? 0.15,
      barrel: b.barrel ?? 8,
      hardhit: b.hardHit ?? 40,
      ev: b.ev ?? 89,
      pullair: (pull * fb) / 100,
      xiso: b.xIso ?? 0.15,
      vsL: null,
      vsR: null,
    });
  }
  for (const [id, p] of savantTrain.pitchers) {
    prior2025P.set(id, {
      hr9: hr9Train.get(id) ?? (p.xIso != null ? p.xIso * 18 : 1.15),
      barrel: p.barrel ?? 8,
      fb: p.flyBall ?? 36,
      ev: p.ev ?? 89,
    });
  }

  const lg = lgDefault();
  const batterLogs = new Map<number, GameLog[]>();
  const pitcherLogs = new Map<number, GameLog[]>();
  const rows: Array<{ date: string; season: number; y: number; x: number[]; rec: Record<string, number> }> = [];

  const boxed: BoxGame[] = [];
  for (const g of games) {
    const b = loadJson<BoxGame | null>(join(DIR, "box", `${g.pk}.json`), null);
    if (b?.bats?.length) boxed.push(b);
  }
  boxed.sort((a, b) => a.date.localeCompare(b.date) || a.pk - b.pk);
  const meta = new Map(games.map((g) => [g.pk, g]));
  for (const g of boxed) {
    const m = meta.get(g.pk);
    if (!m) continue;
    g.venueId = g.venueId || m.venueId;
    g.temp = g.temp ?? m.temp;
    g.windOut = g.windOut ?? m.windOut;
  }

  for (const g of boxed) {
    const season = Number(g.date.slice(0, 4));
    const bMap = season >= 2026 ? prior2025B : batterPrior;
    const pMap = season >= 2026 ? prior2025P : pitcherPrior;
    for (const bat of g.bats) {
      const sp = bat.isHome ? g.awaySp : g.homeSp;
      const whoP = who.get(bat.id);
      const whoS = sp ? who.get(sp) : null;
      const logs = (batterLogs.get(bat.id) ?? []).filter((x) => x.date < g.date).slice(-30);
      const pLogs = sp ? (pitcherLogs.get(sp) ?? []).filter((x) => x.date < g.date).slice(-8) : [];
      const rec = featureRecord({
        prior: bMap.get(bat.id) ?? null,
        pitcher: sp ? pMap.get(sp) ?? null : null,
        logs,
        pitcherLogs: pLogs,
        bats: whoP?.bats ?? "R",
        throws: whoS?.throws ?? "R",
        venueId: g.venueId,
        order: bat.order,
        temp: g.temp,
        windOut: g.windOut,
        lg,
      });
      rows.push({ date: g.date, season, y: bat.hr > 0 ? 1 : 0, x: toRow(rec), rec });
    }
    for (const bat of g.bats) {
      const list = batterLogs.get(bat.id) ?? [];
      list.push({ date: g.date, iso: isoOf(bat), hr: bat.hr, pa: bat.pa, ab: bat.ab });
      batterLogs.set(bat.id, list);
    }
    const pushP = (id: number | null, hr: number, bf: number) => {
      if (!id || bf <= 0) return;
      const list = pitcherLogs.get(id) ?? [];
      list.push({ date: g.date, iso: 0, hr, pa: bf, ab: 0 });
      pitcherLogs.set(id, list);
    };
    pushP(g.awaySp, g.awayHr, g.awayBf);
    pushP(g.homeSp, g.homeHr, g.homeBf);
  }

  const trainRows = rows.filter((r) => r.season === trainSeason && r.date < `${trainSeason}-09-01`);
  const calibRows = rows.filter((r) => r.season === trainSeason && r.date >= `${trainSeason}-09-01`);
  const testRows = rows.filter((r) => r.season === testSeason);

  if (trainRows.length < 500) {
    console.error(`not enough train rows: ${trainRows.length} (need boxscores)`);
    process.exit(1);
  }

  const Xtr = trainRows.map((r) => r.x);
  const ytr = trainRows.map((r) => r.y);
  const std = fitStandardizer(Xtr);
  const Ztr = Xtr.map((r) => applyStandardizer(r, std));

  let bestLam = 1;
  let bestLoss = Infinity;
  let bestW: number[] = [];
  for (const lam of [0.3, 1, 3, 10]) {
    const w = fitLogit(Ztr, ytr, lam);
    const Xc = calibRows.length ? calibRows : trainRows.slice(-Math.floor(trainRows.length * 0.2));
    const yc = Xc.map((r) => r.y);
    const Zc = Xc.map((r) => applyStandardizer(r.x, std));
    const ps = predictP(Zc, w);
    const loss = logLoss(ps, yc);
    console.log(`lambda ${lam} calib logloss ${loss.toFixed(4)}`);
    if (loss < bestLoss) {
      bestLoss = loss;
      bestLam = lam;
      bestW = w;
    }
  }

  const calib = calibRows.length ? calibRows : trainRows.slice(-Math.floor(trainRows.length * 0.2));
  const Zc = calib.map((r) => applyStandardizer(r.x, std));
  const rawC = predictP(Zc, bestW);
  const yC = calib.map((r) => r.y);
  const iso = fitIsotonic(rawC, yC);
  const calC = rawC.map((p) => applyIsotonic(p, iso));
  const cuts = pickCuts(calC, yC, calib.map((r) => r.date));

  const Ztest = testRows.map((r) => applyStandardizer(r.x, std));
  const rawTe = Ztest.length ? predictP(Ztest, bestW) : [];
  const calTe = rawTe.map((p) => applyIsotonic(p, iso));
  const yTe = testRows.map((r) => r.y);

  const art: HrArtifact = {
    version: LOGIT_VERSION,
    trainedAt: new Date().toISOString(),
    priorSeason,
    lambda: bestLam,
    features: FEATURES,
    weights: bestW,
    intercept: bestW[0] ?? 0,
    standardizer: std,
    isotonic: iso,
    cuts,
    metrics: {
      train: metrics(predictP(Ztr, bestW).map((p) => applyIsotonic(p, iso)), ytr),
      calib: metrics(calC, yC),
      test: testRows.length ? metrics(calTe, yTe) : null,
    },
  };

  writeFileSync(join(MODEL_DIR, "current.json"), JSON.stringify(art, null, 2));
  writeFileSync(
    join(MODEL_DIR, "priors.json"),
    JSON.stringify({
      season: trainSeason,
      batters: Object.fromEntries(prior2025B),
      pitchers: Object.fromEntries(prior2025P),
    }),
  );
  const logDump = {
    batter: Object.fromEntries([...batterLogs].map(([id, g]) => [id, g.slice(-30)])),
    pitcher: Object.fromEntries([...pitcherLogs].map(([id, g]) => [id, g.slice(-8)])),
  };
  writeFileSync(join(MODEL_DIR, "logs.json"), JSON.stringify(logDump));

  console.log(JSON.stringify({
    version: art.version,
    lambda: bestLam,
    train: art.metrics.train,
    calib: { n: art.metrics.calib.n, brier: art.metrics.calib.brier, logloss: art.metrics.calib.logloss, base: art.metrics.calib.base },
    test: art.metrics.test ? { n: art.metrics.test.n, brier: art.metrics.test.brier, logloss: art.metrics.test.logloss, base: art.metrics.test.base } : null,
    cuts,
    topWeights: FEATURES.map((n, i) => ({ n, w: bestW[i + 1] }))
      .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
      .slice(0, 8),
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
