import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CAL_BANDS, GAME_HR_RATE, MODEL_VERSION, reliabilityBands } from "./model.ts";
import { shiftISODate } from "./format.ts";
import { fetchJson, parseWalkDays } from "./http.ts";
import type { LockState, PlayerPrediction, WalkDay, WalkForward, WalkWindow } from "./types.ts";
import { studyFromLooks, type BookStudy } from "./book-study.ts";
import { readLock } from "./lock.ts";
import rankBook from "./rank-book.json";

const summaryCache = new Map<string, { exp: number; val: WalkForward }>();
const dayStore = new Map<string, StoredDay>();
const rankStore = new Map<string, StoredDay>();

const OPENING = "2026-03-25";
const FILL_MS = 45000;
const CHUNK = 1;
const POOL = 1;
const BOOK_NEED = 21;
const MLB = "https://statsapi.mlb.com";
const MODULE_WALK = join(fileURLToPath(new URL(".", import.meta.url)), "../../../data/walk");
const DATA_DIR_CANDIDATES = [MODULE_WALK, join(process.cwd(), "data", "walk"), "/workspace/data/walk"];

let hydrated = false;
let lookIndex: Map<number, StoredLook[]> | null = null;
let fillChain: Promise<unknown> = Promise.resolve();
const failUntil = new Map<string, number>();
let datesMemo: { asOf: string; exp: number; dates: string[] } | null = null;

function walkDir(): string {
  for (const dir of DATA_DIR_CANDIDATES) {
    try {
      readFileSync(join(dir, `${MODEL_VERSION}-lanes1.json`), "utf8");
      return dir;
    } catch {
      try {
        readFileSync(join(dir, `${MODEL_VERSION}.json`), "utf8");
        return dir;
      } catch {
        /* try next */
      }
    }
  }
  return DATA_DIR_CANDIDATES[0];
}

function storePath() {
  return join(walkDir(), `${MODEL_VERSION}-lanes1.json`);
}

function rankPath() {
  return join(walkDir(), `${MODEL_VERSION}.json`);
}

function hydrateDayStore() {
  if (hydrated) return;
  hydrated = true;
  for (const dir of DATA_DIR_CANDIDATES) {
    loadInto(join(dir, `${MODEL_VERSION}-lanes1.json`), dayStore);
    loadInto(join(dir, `${MODEL_VERSION}.json`), rankStore);
  }
}

function loadInto(path: string, into: Map<string, StoredDay>) {
  try {
    const days = parseWalkDays(JSON.parse(readFileSync(path, "utf8")));
    for (const d of days) {
      const looks = d.looks.filter((l): l is StoredLook => lookOk(l));
      if (looks.length === 0) continue;
      into.set(d.date, {
        date: d.date,
        games: d.games ?? looks.length,
        lockStatus: d.lockStatus === "locked" ? "locked" : "rebuilt",
        lanes: 1,
        looks,
      });
    }
  } catch {
    /* first run */
  }
}

function lookOk(raw: unknown): raw is StoredLook {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    Number.isFinite(r.playerId) &&
    Number.isFinite(r.gamePk) &&
    Number.isFinite(r.pHr) &&
    (r.y === 0 || r.y === 1)
  );
}

function flushDayStore() {
  try {
    const dir = walkDir();
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${MODEL_VERSION}-lanes1.json`);
    const onDisk = new Map<string, StoredDay>();
    loadInto(path, onDisk);
    for (const [date, d] of dayStore) {
      if (d.lanes === 1 && d.looks.length > 0) onDisk.set(date, d);
    }
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify([...onDisk.values()]));
    renameSync(tmp, path);
  } catch {
    /* Vercel / read-only — in-memory still works this process */
  }
}

type StoredLook = {
  playerId: number;
  gamePk: number;
  pHr: number;
  y: 0 | 1;
  hr: number;
  top12: boolean;
  seasonHr: number;
  seasonPa: number;
  air: number;
  cut: boolean;
  yards: boolean;
  mix: boolean;
  both20: boolean;
  mixHr: number;
  pitcherId?: number;
  converge: number;
  env: number;
  topConv: boolean;
  topEnv: boolean;
};

type StoredDay = {
  date: string;
  games: number;
  lockStatus: LockState["status"];
  lanes: 1;
  looks: StoredLook[];
};

type Tagged = StoredLook & { date: string; baseline: boolean; last5: boolean; last10: boolean };

function enqueueFill(fn: () => Promise<void>): Promise<void> {
  const run = fillChain.then(fn, fn);
  fillChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function loadWalkForward(asOf: string, opts?: { fill?: boolean }): Promise<WalkForward | null> {
  hydrateDayStore();
  const end = shiftISODate(asOf, -1);
  if (end < OPENING) return null;
  const mlb = await listCompletedDates(asOf);
  const dates = bookDates(end, mlb);
  if (dates.length === 0) return null;

  const snapshot = summarize(dates, asOf);
  const due = dueDate(mlb);
  if (!due || !opts?.fill) return snapshot;

  await Promise.race([enqueueFill(() => fillChunk([due])), sleep(FILL_MS)]);
  return summarize(bookDates(end, mlb), asOf);
}

function bookDates(end: string, mlb: string[]): string[] {
  const s = new Set<string>();
  for (const d of rankStore.keys()) if (d <= end && d >= OPENING) s.add(d);
  for (const d of dayStore.keys()) if (d <= end && d >= OPENING) s.add(d);
  for (const d of mlb) if (d <= end && d >= OPENING) s.add(d);
  return [...s].sort((a, b) => b.localeCompare(a));
}

function isSaved(d: StoredDay | undefined): boolean {
  return !!d && d.looks.length > 0;
}

function dueDate(dates: string[]): string | null {
  const newest = dates[0];
  if (!newest) return null;
  if ((failUntil.get(newest) ?? 0) > Date.now()) return null;
  return isSaved(dayStore.get(newest)) ? null : newest;
}

async function fillChunk(dates: string[]) {
  const { loadBoard } = await import("./board.server");
  const missing = dates.slice(0, CHUNK);
  if (missing.length === 0) return;
  for (let i = 0; i < missing.length; i += POOL) {
    const batch = missing.slice(i, i + POOL);
    const boards = await Promise.all(
      batch.map((date) => loadBoard(date).catch(() => null)),
    );
    for (let j = 0; j < batch.length; j++) {
      const date = batch[j];
      const board = boards[j];
      if (!board || board.summary.completedGames === 0 || board.predictions.length === 0) {
        failUntil.set(date, Date.now() + 3 * 60_000);
        continue;
      }
      if (board.summary.games >= 8 && board.summary.completedGames < board.summary.games * 0.6) {
        failUntil.set(date, Date.now() + 3 * 60_000);
        continue;
      }
      const stored = storeDay(board);
      if (stored.looks.length === 0) {
        failUntil.set(date, Date.now() + 3 * 60_000);
        continue;
      }
      dayStore.set(date, stored);
      lookIndex = null;
    }
    flushDayStore();
  }
}

export function bustWalkForward() {
  summaryCache.clear();
}

function dayKey(date: string) {
  return `${MODEL_VERSION}:${date}`;
}

type RankNight = (typeof rankBook.nights)[number];

function liveNight(d: StoredDay): RankNight {
  const looks = d.looks;
  const top = looks.filter((p) => p.top12);
  const rest = looks.filter((p) => !p.top12);
  const hits = (xs: StoredLook[]) => xs.reduce((s, p) => s + p.y, 0);
  return {
    date: d.date,
    games: d.games,
    looks: looks.length,
    top12Looks: top.length,
    top12Hits: hits(top),
    restLooks: rest.length,
    restHits: hits(rest),
    hrN: hits(looks),
    meanP: looks.length ? looks.reduce((s, p) => s + p.pHr, 0) / looks.length : 0,
    lock: d.lockStatus,
  };
}

function allNights(end: string): RankNight[] {
  const m = new Map<string, RankNight>();
  for (const n of rankBook.nights) {
    if (n.date <= end) m.set(n.date, n);
  }
  for (const d of rankStore.values()) if (isSaved(d) && d.date <= end) m.set(d.date, liveNight(d));
  for (const d of dayStore.values()) if (isSaved(d) && d.date <= end) m.set(d.date, liveNight(d));
  return [...m.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function walkDayFromNight(n: RankNight): WalkDay {
  const lockStatus: LockState["status"] = n.lock === "locked" ? "locked" : "rebuilt";
  return {
    date: n.date,
    games: n.games,
    n: n.looks,
    top12WithHr: n.top12Hits,
    top12Rate: n.top12Looks ? n.top12Hits / n.top12Looks : null,
    restRate: n.restLooks ? n.restHits / n.restLooks : null,
    meanP: n.meanP,
    actualRate: n.looks ? n.hrN / n.looks : null,
    brier: null,
    brierSkill: null,
    hrN: n.hrN,
    capture12: n.hrN ? n.top12Hits / n.hrN : null,
    lockStatus,
    baselineHits: null,
    baselineN: null,
    cutHits: null,
    mixHits: null,
    yardsHits: null,
  };
}

function windowFromNights(key: WalkWindow["key"], label: string, nights: RankNight[], lanes: ReturnType<typeof laneFields>, looks: StoredLook[]): WalkWindow {
  const nLooks = nights.reduce((s, n) => s + n.looks, 0);
  const top12Looks = nights.reduce((s, n) => s + n.top12Looks, 0);
  const top12Hits = nights.reduce((s, n) => s + n.top12Hits, 0);
  const restLooks = nights.reduce((s, n) => s + n.restLooks, 0);
  const restHits = nights.reduce((s, n) => s + n.restHits, 0);
  const hrN = nights.reduce((s, n) => s + n.hrN, 0);
  const top12Rate = top12Looks ? top12Hits / top12Looks : 0;
  const restRate = restLooks ? restHits / restLooks : 0;
  const lift = top12Rate - restRate;
  const se = Math.sqrt(
    (top12Looks ? (top12Rate * (1 - top12Rate)) / top12Looks : 0) +
      (restLooks ? (restRate * (1 - restRate)) / restLooks : 0),
  );
  const emptyLanes = laneFields([]);
  const brier = brierOf(looks);
  const brierRef = looks.length
    ? looks.reduce((s, r) => s + (GAME_HR_RATE - r.y) ** 2, 0) / looks.length
    : 0;
  return {
    key,
    label,
    from: nights[nights.length - 1]?.date ?? "",
    to: nights[0]?.date ?? "",
    days: nights.length,
    looks: nLooks,
    top12Hits,
    top12Looks,
    top12Rate,
    restRate,
    lift,
    liftLo: lift - 1.96 * se,
    liftHi: lift + 1.96 * se,
    baselineRate: restRate,
    baselineHits: restHits,
    baselineLooks: restLooks,
    last5Rate: 0,
    last5Hits: 0,
    last5Looks: 0,
    last10Rate: 0,
    last10Hits: 0,
    last10Looks: 0,
    last10Capture: 0,
    cut16Rate: 0,
    cut16N: 0,
    brier,
    skill: brierRef > 0 ? 1 - brier / brierRef : 0,
    hrN,
    capture12: hrN > 0 ? top12Hits / hrN : 0,
    capture6: 0,
    ap: 0,
    ece: eceOf(looks),
    logLossSkill: 0,
    ...(key === "season" ? lanes : emptyLanes),
  };
}

function summarize(dates: string[], asOf: string): WalkForward {
  const end = shiftISODate(asOf, -1);
  const nights = allNights(end);
  const storedLive = dates.map((d) => dayStore.get(d) ?? rankStore.get(d)).filter((d): d is StoredDay => isSaved(d));
  const laneDays = [...dayStore.values()].filter((d) => d.lanes === 1 && d.looks.length > 0);
  const laneDates = new Set(laneDays.map((d) => d.date));
  const due = dueDate(dates);
  const pending = due ? 1 : 0;
  if (nights.length === 0) return emptyWalk(asOf, dates, pending);

  const cacheKey = `walk:${MODEL_VERSION}:book1:${asOf}:${nights.length}:${laneDays.length}:${pending}`;
  const hit = summaryCache.get(cacheKey);
  if (hit && hit.exp > Date.now()) return hit.val;

  const tagged = tagRankers(laneDays);
  const lanes = laneFields(tagged.filter((r) => laneDates.has(r.date)));
  const last5 = nights.slice(0, 5);
  const last10 = nights.slice(0, 10);
  const looksOf = (ns: RankNight[]) =>
    ns.flatMap((n) => (liveByDatePrep(n.date) ?? { looks: [] as StoredLook[] }).looks);
  const liveByDatePrep = (date: string) => dayStore.get(date) ?? rankStore.get(date);
  const windows: WalkWindow[] = [
    windowFromNights("last5", "Last 5 days", last5, lanes, looksOf(last5)),
    windowFromNights("last10", "Last 10 days", last10, lanes, looksOf(last10)),
    windowFromNights("season", "Season", nights, lanes, looksOf(nights)),
  ];
  const season = windows[2];
  const liveByDate = new Map(storedLive.map((d) => [d.date, d]));
  const byDay = nights.map((n) => {
    const live = liveByDate.get(n.date);
    if (live && live.lanes === 1) return toWalkDay(live, tagged.filter((r) => r.date === n.date));
    return walkDayFromNight(n);
  });
  const ranked = [...byDay].filter((d) => d.top12Rate != null);
  ranked.sort((a, b) => (b.top12Rate ?? 0) - (a.top12Rate ?? 0));

  const val: WalkForward = {
    model: MODEL_VERSION,
    from: nights[nights.length - 1]?.date ?? asOf,
    to: nights[0]?.date ?? asOf,
    days: nights.length,
    looks: season.looks,
    top12Looks: season.top12Looks,
    top12Hits: season.top12Hits,
    top12Rate: season.top12Rate,
    restRate: season.restRate,
    meanP: rankBook.meanP,
    actualRate: rankBook.actualRate,
    brier: season.brier,
    skill: season.skill,
    logLoss: 0,
    hrN: season.hrN,
    capture12: season.capture12,
    capture6: season.capture6,
    ap: season.ap,
    ece: season.ece,
    logLossSkill: season.logLossSkill,
    lift: season.lift,
    liftLo: season.liftLo,
    liftHi: season.liftHi,
    lockedDays: byDay.filter((d) => d.lockStatus === "locked").length,
    rebuiltDays: byDay.filter((d) => d.lockStatus !== "locked").length,
    lockedReady: nights.length >= BOOK_NEED,
    cutBeatsLast10: lanes.cutRate > 0.12,
    last10Capture: season.last10Capture,
    baselineTop12Looks: season.baselineLooks,
    baselineTop12Hits: season.baselineHits,
    baselineTop12Rate: season.baselineRate,
    baselineLift: season.baselineRate - season.restRate,
    cut16N: 0,
    cut16Rate: 0,
    below16N: 0,
    below16Rate: 0,
    ...lanes,
    bestDays: ranked.slice(0, 3),
    worstDays: [...ranked].reverse().slice(0, 3),
    calibration: liveCalib(looksOf(nights)),
    byDay,
    windows,
    pending,
    totalDays: nights.length,
    laneDays: laneDays.length,
  };
  summaryCache.set(cacheKey, { exp: Date.now() + (pending ? 8_000 : 45 * 60_000), val });
  return val;
}

function emptyWalk(asOf: string, dates: string[], pending: number): WalkForward {
  return {
    model: MODEL_VERSION,
    from: dates[dates.length - 1] ?? asOf,
    to: dates[0] ?? asOf,
    days: 0,
    looks: 0,
    top12Looks: 0,
    top12Hits: 0,
    top12Rate: 0,
    restRate: 0,
    meanP: 0,
    actualRate: 0,
    brier: 0,
    skill: 0,
    logLoss: 0,
    hrN: 0,
    capture12: 0,
    capture6: 0,
    ap: 0,
    ece: 0,
    logLossSkill: 0,
    lift: 0,
    liftLo: 0,
    liftHi: 0,
    lockedDays: 0,
    rebuiltDays: 0,
    lockedReady: false,
    cutBeatsLast10: false,
    last10Capture: 0,
    baselineTop12Looks: 0,
    baselineTop12Hits: 0,
    baselineTop12Rate: 0,
    baselineLift: 0,
    cut16N: 0,
    cut16Rate: 0,
    below16N: 0,
    below16Rate: 0,
    cutLooks: 0,
    cutHits: 0,
    cutRate: 0,
    cutCapture: 0,
    yardsLooks: 0,
    yardsHits: 0,
    yardsRate: 0,
    yardsCapture: 0,
    mixLooks: 0,
    mixHits: 0,
    mixRate: 0,
    mixCapture: 0,
    convLooks: 0,
    convHits: 0,
    convRate: 0,
    convCapture: 0,
    envLooks: 0,
    envHits: 0,
    envRate: 0,
    envCapture: 0,
    bestDays: [],
    worstDays: [],
    calibration: [],
    byDay: [],
    windows: [],
    pending,
    totalDays: 0,
    laneDays: 0,
  };
}

function storeDay(board: {
  date: string;
  summary: { completedGames: number };
  lock: { status: LockState["status"] };
  predictions: PlayerPrediction[];
}): StoredDay {
  const withY = board.predictions.filter((p) => p.actualHr != null);
  const topIds = new Set(
    [...withY]
      .sort((a, b) => b.pHr - a.pHr)
      .slice(0, 12)
      .map((p) => `${p.playerId}:${p.gamePk}`),
  );
  const convIds = new Set(
    [...withY]
      .sort((a, b) => b.signal.decision.converge - a.signal.decision.converge || b.signal.decision.bvp - a.signal.decision.bvp)
      .slice(0, 6)
      .map((p) => `${p.playerId}:${p.gamePk}`),
  );
  const envIds = new Set(
    [...withY]
      .filter((p) => p.battingOrder <= 6)
      .sort((a, b) => b.signal.decision.env - a.signal.decision.env)
      .slice(0, 6)
      .map((p) => `${p.playerId}:${p.gamePk}`),
  );
  const looks: StoredLook[] = [];
  const lock = readLock(board.date);
  const locked = new Map<string, number>((lock?.looks ?? []).map((l) => [`${l.playerId}:${l.gamePk}`, l.pHr]));
  for (const p of withY) {
    const id = `${p.playerId}:${p.gamePk}`;
    looks.push({
      playerId: p.playerId,
      gamePk: p.gamePk,
      pHr: locked.get(id) ?? p.pHr,
      y: (p.actualHr ?? 0) > 0 ? 1 : 0,
      hr: p.actualHr ?? 0,
      top12: topIds.has(id),
      seasonHr: p.season.hr,
      seasonPa: p.season.pa,
      air: p.park.airIndex > 0 ? p.park.airIndex / 100 : 1,
      cut: p.signal.decision.pass,
      yards: p.signal.decision.yards,
      mix: !!p.signal.keyMatch?.loud || p.signal.decision.mixHr >= 2 || p.signal.decision.both20,
      both20: p.signal.decision.both20,
      mixHr: p.signal.decision.mixHr,
      pitcherId: p.pitcher?.id,
      converge: p.signal.decision.converge,
      env: p.signal.decision.env,
      topConv: convIds.has(id),
      topEnv: envIds.has(id),
    });
  }
  return {
    date: board.date,
    games: board.summary.completedGames,
    lockStatus: lock ? "locked" : board.lock.status,
    lanes: 1,
    looks,
  };
}

function tagRankers(days: StoredDay[]): Tagged[] {
  const hist = new Map<number, Array<{ date: string; hr: number }>>();
  const chrono = [...days].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of chrono) {
    for (const p of d.looks) {
      const arr = hist.get(p.playerId) ?? [];
      arr.push({ date: d.date, hr: p.hr });
      hist.set(p.playerId, arr);
    }
  }
  const out: Tagged[] = [];
  for (const d of days) {
    const seasonIds = topIdsBy(d.looks, (p) => (p.seasonPa > 20 ? p.seasonHr / p.seasonPa : 0) * p.air);
    const last5Ids = topIdsBy(d.looks, (p) => rollingHr(hist, p.playerId, d.date, 5) * p.air);
    const last10Ids = topIdsBy(d.looks, (p) => rollingHr(hist, p.playerId, d.date, 10) * p.air);
    for (const p of d.looks) {
      const id = `${p.playerId}:${p.gamePk}`;
      out.push({
        ...p,
        date: d.date,
        baseline: seasonIds.has(id),
        last5: last5Ids.has(id),
        last10: last10Ids.has(id),
      });
    }
  }
  return out;
}

function rollingHr(
  hist: Map<number, Array<{ date: string; hr: number }>>,
  playerId: number,
  before: string,
  n: number,
): number {
  const gs = (hist.get(playerId) ?? [])
    .filter((g) => g.date < before)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);
  if (gs.length < Math.min(3, n)) return 0;
  return gs.reduce((s, g) => s + g.hr, 0) / gs.length;
}

function topIdsBy(looks: StoredLook[], score: (p: StoredLook) => number): Set<string> {
  return new Set(
    [...looks]
      .sort((a, b) => score(b) - score(a))
      .slice(0, 12)
      .map((p) => `${p.playerId}:${p.gamePk}`),
  );
}

function toWalkDay(d: StoredDay, rows: Tagged[]): WalkDay {
  const top = rows.filter((r) => r.top12);
  const rest = rows.filter((r) => !r.top12);
  const base = rows.filter((r) => r.baseline);
  const brier = brierOf(rows);
  const brierRef = rows.length
    ? rows.reduce((s, r) => s + (GAME_HR_RATE - r.y) ** 2, 0) / rows.length
    : 0;
  const hrN = rows.reduce((s, r) => s + r.y, 0);
  const topHits = top.filter((r) => r.y).length;
  return {
    date: d.date,
    games: d.games,
    n: rows.length,
    top12WithHr: topHits,
    top12Rate: rate(top),
    restRate: rate(rest),
    meanP: rows.length ? rows.reduce((s, r) => s + r.pHr, 0) / rows.length : 0,
    actualRate: rate(rows),
    brier,
    brierSkill: brierRef > 0 ? 1 - brier / brierRef : null,
    hrN,
    capture12: hrN > 0 ? topHits / hrN : null,
    lockStatus: d.lockStatus,
    baselineHits: base.filter((r) => r.y).length,
    baselineN: base.length,
    cutHits: rows.filter((r) => r.cut && r.y).length,
    mixHits: rows.filter((r) => r.mix && r.y).length,
    yardsHits: rows.filter((r) => r.yards && r.y).length,
  };
}

function makeWindow(key: WalkWindow["key"], label: string, days: StoredDay[], rows: Tagged[]): WalkWindow {
  const top = rows.filter((r) => r.top12);
  const rest = rows.filter((r) => !r.top12);
  const base = rows.filter((r) => r.baseline);
  const l5 = rows.filter((r) => r.last5);
  const l10 = rows.filter((r) => r.last10);
  const top12Rate = rate(top);
  const restRate = rate(rest);
  const lift = top12Rate - restRate;
  const se = Math.sqrt(
    (top12Rate * (1 - top12Rate)) / Math.max(1, top.length) +
      (restRate * (1 - restRate)) / Math.max(1, rest.length),
  );
  const brier = brierOf(rows);
  const brierRef = rows.length
    ? rows.reduce((s, r) => s + (GAME_HR_RATE - r.y) ** 2, 0) / rows.length
    : 1;
  const hi = rows.filter((r) => r.pHr >= 0.16);
  const hrN = rows.reduce((s, r) => s + r.y, 0);
  const topHits = top.reduce((s, r) => s + r.y, 0);
  return {
    key,
    label,
    from: days[days.length - 1]?.date ?? "",
    to: days[0]?.date ?? "",
    days: days.length,
    looks: rows.length,
    top12Hits: topHits,
    top12Looks: top.length,
    top12Rate,
    restRate,
    lift,
    liftLo: lift - 1.96 * se,
    liftHi: lift + 1.96 * se,
    baselineRate: rate(base),
    last5Rate: rate(l5),
    last5Hits: l5.reduce((s, r) => s + r.y, 0),
    last5Looks: l5.length,
    last10Rate: rate(l10),
    last10Hits: l10.reduce((s, r) => s + r.y, 0),
    last10Looks: l10.length,
    last10Capture: hrN > 0 ? l10.reduce((s, r) => s + r.y, 0) / hrN : 0,
    baselineHits: base.reduce((s, r) => s + r.y, 0),
    baselineLooks: base.length,
    cut16Rate: rate(hi),
    cut16N: hi.length,
    brier,
    skill: brierRef > 0 ? 1 - brier / brierRef : 0,
    hrN,
    capture12: hrN > 0 ? topHits / hrN : 0,
    ...rankFields(days, rows),
    ...laneFields(rows),
  };
}

function captureAtK(days: StoredDay[], k: number): number {
  let got = 0;
  let hr = 0;
  for (const d of days) {
    const ranked = [...d.looks].sort((a, b) => b.pHr - a.pHr);
    hr += ranked.reduce((s, r) => s + r.y, 0);
    got += ranked.slice(0, k).reduce((s, r) => s + r.y, 0);
  }
  return hr > 0 ? got / hr : 0;
}

function averagePrecision(looks: StoredLook[]): number {
  const ranked = [...looks].sort((a, b) => b.pHr - a.pHr);
  let hits = 0;
  let sum = 0;
  for (let i = 0; i < ranked.length; i++) {
    if (!ranked[i].y) continue;
    hits += 1;
    sum += hits / (i + 1);
  }
  return hits > 0 ? sum / hits : 0;
}

function meanAP(days: StoredDay[]): number {
  const xs = days.map((d) => averagePrecision(d.looks)).filter((n) => n > 0);
  if (xs.length === 0) return 0;
  return xs.reduce((s, n) => s + n, 0) / xs.length;
}

function eceOf(rows: Array<{ pHr: number; y: 0 | 1 }>): number {
  const n = rows.length;
  if (n === 0) return 0;
  let s = 0;
  for (const b of CAL_BANDS) {
    const xs = rows.filter((r) => r.pHr >= b.min && r.pHr < b.max);
    if (xs.length === 0) continue;
    const meanP = xs.reduce((a, r) => a + r.pHr, 0) / xs.length;
    const actual = xs.reduce((a, r) => a + r.y, 0) / xs.length;
    s += (xs.length / n) * Math.abs(meanP - actual);
  }
  return s;
}

function liveCalib(rows: Array<{ pHr: number; y: 0 | 1 }>): WalkForward["calibration"] {
  const bands = reliabilityBands(rows);
  if (bands.length === 0) return rankBook.calibration;
  return bands.map((b) => ({
    label: b.thin ? `${b.label} · n=${b.n} thin` : b.label,
    n: b.n,
    meanP: b.meanP,
    actualRate: b.actualRate,
  }));
}

function logLossSkillOf(rows: Array<{ pHr: number; y: 0 | 1 }>): number {
  const ll = logLossOf(rows);
  if (rows.length === 0) return 0;
  const p = Math.min(1 - 1e-6, Math.max(1e-6, GAME_HR_RATE));
  const ref =
    rows.reduce((s, r) => s + (r.y ? -Math.log(p) : -Math.log(1 - p)), 0) / rows.length;
  return ref > 0 ? 1 - ll / ref : 0;
}

function rankFields(days: StoredDay[], rows: Tagged[]) {
  return {
    capture6: captureAtK(days, 6),
    ap: meanAP(days),
    ece: eceOf(rows),
    logLossSkill: logLossSkillOf(rows),
  };
}

function laneOf(rows: Tagged[], pick: (r: Tagged) => boolean) {
  const xs = rows.filter(pick);
  const hits = xs.reduce((s, r) => s + r.y, 0);
  const hrN = rows.reduce((s, r) => s + r.y, 0);
  return { looks: xs.length, hits, rate: rate(xs), capture: hrN > 0 ? hits / hrN : 0 };
}

function laneFields(rows: Tagged[]) {
  const cut = laneOf(rows, (r) => r.cut);
  const yards = laneOf(rows, (r) => r.yards);
  const mix = laneOf(rows, (r) => r.mix);
  const conv = laneOf(rows, (r) => r.topConv);
  const env = laneOf(rows, (r) => r.topEnv);
  return {
    cutLooks: cut.looks,
    cutHits: cut.hits,
    cutRate: cut.rate,
    cutCapture: cut.capture,
    yardsLooks: yards.looks,
    yardsHits: yards.hits,
    yardsRate: yards.rate,
    yardsCapture: yards.capture,
    mixLooks: mix.looks,
    mixHits: mix.hits,
    mixRate: mix.rate,
    mixCapture: mix.capture,
    convLooks: conv.looks,
    convHits: conv.hits,
    convRate: conv.rate,
    convCapture: conv.capture,
    envLooks: env.looks,
    envHits: env.hits,
    envRate: env.rate,
    envCapture: env.capture,
  };
}

function rate(rows: Array<{ y: 0 | 1 }>): number {
  if (rows.length === 0) return 0;
  return rows.reduce((s, r) => s + r.y, 0) / rows.length;
}

export function brierOf(rows: Array<{ pHr: number; y: 0 | 1 }>): number {
  if (rows.length === 0) return 0;
  return rows.reduce((s, r) => s + (r.pHr - r.y) ** 2, 0) / rows.length;
}

function logLossOf(rows: Array<{ pHr: number; y: 0 | 1 }>): number {
  if (rows.length === 0) return 0;
  return (
    rows.reduce((s, r) => {
      const p = Math.min(1 - 1e-6, Math.max(1e-6, r.pHr));
      return s + (r.y ? -Math.log(p) : -Math.log(1 - p));
    }, 0) / rows.length
  );
}

async function listCompletedDates(asOf: string): Promise<string[]> {
  const start = OPENING;
  const end = shiftISODate(asOf, -1);
  if (end < start) return [];
  const memo = datesMemo;
  if (memo && memo.asOf === asOf && memo.exp > Date.now()) return memo.dates;
  try {
    const data = await fetchJson<{
      dates?: Array<{
        date: string;
        games?: Array<{ status?: { abstractGameState?: string } }>;
      }>;
    }>(`${MLB}/api/v1/schedule?sportId=1&startDate=${start}&endDate=${end}`, undefined, 12_000);
    const dates: string[] = [];
    for (const day of [...(data.dates ?? [])].sort((a, b) => b.date.localeCompare(a.date))) {
      const finals = (day.games ?? []).some((g) => (g.status?.abstractGameState ?? "").toLowerCase() === "final");
      if (finals) dates.push(day.date);
    }
    datesMemo = { asOf, exp: Date.now() + 10 * 60_000, dates };
    return dates;
  } catch {
    const fallback: string[] = [];
    for (let i = 1; i <= 200; i++) {
      const d = shiftISODate(asOf, -i);
      if (d < start) break;
      fallback.push(d);
    }
    return fallback;
  }
}

function ensureLookIndex(): Map<number, StoredLook[]> {
  hydrateDayStore();
  if (lookIndex) return lookIndex;
  const days = new Map<string, StoredDay>();
  for (const d of rankStore.values()) days.set(d.date, d);
  for (const d of dayStore.values()) days.set(d.date, d);
  const m = new Map<number, StoredLook[]>();
  for (const d of days.values()) {
    for (const l of d.looks) {
      const arr = m.get(l.playerId) ?? [];
      arr.push(l);
      m.set(l.playerId, arr);
    }
  }
  lookIndex = m;
  return m;
}

export function studyPlayer(playerId: number, pitcherId?: number | null): BookStudy {
  const looks = ensureLookIndex().get(playerId) ?? [];
  return studyFromLooks(looks, pitcherId);
}
