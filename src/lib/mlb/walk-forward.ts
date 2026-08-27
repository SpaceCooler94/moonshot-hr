import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CAL_BANDS, MODEL_VERSION, STARTER_HR_RATE } from "./model";
import { shiftISODate } from "./format";
import type { LockState, PlayerPrediction, WalkDay, WalkForward, WalkWindow } from "./types";

const summaryCache = new Map<string, { exp: number; val: WalkForward }>();
const dayStore = new Map<string, StoredDay>();

const OPENING = "2026-03-25";
const CHUNK = 12;
const POOL = 3;
const MLB = "https://statsapi.mlb.com";
const DATA_DIR = join(process.cwd(), "data", "walk");

let hydrated = false;

function storePath() {
  return join(DATA_DIR, `${MODEL_VERSION}.json`);
}

function hydrateDayStore() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = readFileSync(storePath(), "utf8");
    const days = JSON.parse(raw) as StoredDay[];
    if (!Array.isArray(days)) return;
    for (const d of days) {
      if (d?.date) dayStore.set(dayKey(d.date), d);
    }
  } catch {
    /* first run or read-only host */
  }
}

function flushDayStore() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const days = [...dayStore.entries()]
      .filter(([k]) => k.startsWith(`${MODEL_VERSION}:`))
      .map(([, v]) => v);
    writeFileSync(storePath(), JSON.stringify(days));
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
};

type StoredDay = {
  date: string;
  games: number;
  lockStatus: LockState["status"];
  looks: StoredLook[];
};

type Tagged = StoredLook & { date: string; baseline: boolean; last5: boolean; last10: boolean };

export async function loadWalkForward(asOf: string): Promise<WalkForward | null> {
  hydrateDayStore();
  const dates = await listCompletedDates(asOf);
  if (dates.length === 0) return null;

  const { loadBoard } = await import("./board.server");
  const retryAfter = shiftISODate(asOf, -3);
  const missing = dates
    .filter((d) => {
      const hit = dayStore.get(dayKey(d));
      if (!hit) return true;
      // Empty placeholder for a day that later went final — retry the last couple.
      if (hit.looks.length === 0 && hit.games === 0 && d >= retryAfter) return true;
      return false;
    })
    .slice(0, CHUNK);
  for (let i = 0; i < missing.length; i += POOL) {
    const batch = missing.slice(i, i + POOL);
    const boards = await Promise.all(batch.map((date) => loadBoard(date).catch(() => null)));
    for (let j = 0; j < batch.length; j++) {
      const board = boards[j];
      const date = batch[j];
      if (!board || board.summary.completedGames === 0 || board.predictions.length === 0) {
        dayStore.set(dayKey(date), {
          date,
          games: 0,
          lockStatus: "rebuilt",
          looks: [],
        });
        continue;
      }
      dayStore.set(dayKey(date), storeDay(board));
    }
    flushDayStore();
  }

  const stored = dates
    .map((d) => dayStore.get(dayKey(d)))
    .filter((d): d is StoredDay => !!d && d.looks.length > 0);
  if (stored.length === 0) return null;

  const pending = dates.filter((d) => !dayStore.has(dayKey(d))).length;
  const cacheKey = `walk:${MODEL_VERSION}:szn:${asOf}:${stored.length}:${pending}`;
  const hit = summaryCache.get(cacheKey);
  if (hit && hit.exp > Date.now()) return hit.val;

  const tagged = tagRankers(stored);
  const byDay = stored.map((d) => toWalkDay(d, tagged.filter((r) => r.date === d.date)));
  const seasonRows = tagged;
  const last5Days = stored.slice(0, 5);
  const last10Days = stored.slice(0, 10);
  const last5Rows = tagged.filter((r) => last5Days.some((d) => d.date === r.date));
  const last10Rows = tagged.filter((r) => last10Days.some((d) => d.date === r.date));

  const windows: WalkWindow[] = [
    makeWindow("last5", "Last 5 days", last5Days, last5Rows),
    makeWindow("last10", "Last 10 days", last10Days, last10Rows),
    makeWindow("season", "Season", stored, seasonRows),
  ];
  const season = windows[2];
  const ranked = [...byDay].filter((d) => d.top12Rate != null);
  ranked.sort((a, b) => (b.top12Rate ?? 0) - (a.top12Rate ?? 0));
  const hi = seasonRows.filter((r) => r.pHr >= 0.16);
  const lo = seasonRows.filter((r) => r.pHr < 0.16);
  const calibration = CAL_BANDS.map((b) => {
    const xs = seasonRows.filter((r) => r.pHr >= b.min && r.pHr < b.max);
    return {
      label: b.label,
      n: xs.length,
      meanP: xs.length ? xs.reduce((s, r) => s + r.pHr, 0) / xs.length : 0,
      actualRate: xs.length ? xs.reduce((s, r) => s + r.y, 0) / xs.length : 0,
    };
  }).filter((b) => b.n > 0);

  const val: WalkForward = {
    model: MODEL_VERSION,
    from: stored[stored.length - 1]?.date ?? asOf,
    to: stored[0]?.date ?? asOf,
    days: stored.length,
    looks: season.looks,
    top12Looks: season.top12Looks,
    top12Hits: season.top12Hits,
    top12Rate: season.top12Rate,
    restRate: season.restRate,
    meanP: seasonRows.reduce((s, r) => s + r.pHr, 0) / Math.max(1, seasonRows.length),
    actualRate: rate(seasonRows),
    brier: season.brier,
    skill: season.skill,
    logLoss: logLossOf(seasonRows),
    lift: season.lift,
    liftLo: season.liftLo,
    liftHi: season.liftHi,
    lockedDays: byDay.filter((d) => d.lockStatus === "locked").length,
    rebuiltDays: byDay.filter((d) => d.lockStatus !== "locked").length,
    baselineTop12Looks: season.baselineLooks,
    baselineTop12Hits: season.baselineHits,
    baselineTop12Rate: season.baselineRate,
    baselineLift: season.baselineRate - season.restRate,
    cut16N: hi.length,
    cut16Rate: rate(hi),
    below16N: lo.length,
    below16Rate: rate(lo),
    bestDays: ranked.slice(0, 3),
    worstDays: [...ranked].reverse().slice(0, 3),
    calibration,
    byDay,
    windows,
    pending,
    totalDays: dates.length,
  };
  // Don't freeze an incomplete season for long — keep filling.
  summaryCache.set(cacheKey, { exp: Date.now() + (pending ? 15_000 : 45 * 60_000), val });
  return val;
}

export function bustWalkForward() {
  summaryCache.clear();
}

function dayKey(date: string) {
  return `${MODEL_VERSION}:${date}`;
}

function storeDay(board: {
  date: string;
  summary: { completedGames: number };
  lock: { status: LockState["status"] };
  predictions: PlayerPrediction[];
}): StoredDay {
  const topIds = new Set(board.predictions.slice(0, 12).map((p) => `${p.playerId}:${p.gamePk}`));
  const looks: StoredLook[] = [];
  for (const p of board.predictions) {
    if (p.actualHr == null) continue;
    looks.push({
      playerId: p.playerId,
      gamePk: p.gamePk,
      pHr: p.pHr,
      y: p.actualHr > 0 ? 1 : 0,
      hr: p.actualHr,
      top12: topIds.has(`${p.playerId}:${p.gamePk}`),
      seasonHr: p.season.hr,
      seasonPa: p.season.pa,
      air: p.park.airIndex > 0 ? p.park.airIndex / 100 : 1,
    });
  }
  return {
    date: board.date,
    games: board.summary.completedGames,
    lockStatus: board.lock.status,
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
  return {
    date: d.date,
    games: d.games,
    n: rows.length,
    top12WithHr: top.filter((r) => r.y).length,
    top12Rate: rate(top),
    restRate: rate(rest),
    meanP: rows.length ? rows.reduce((s, r) => s + r.pHr, 0) / rows.length : 0,
    actualRate: rate(rows),
    brier: brierOf(rows),
    lockStatus: d.lockStatus,
    baselineHits: base.filter((r) => r.y).length,
    baselineN: base.length,
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
    ? rows.reduce((s, r) => s + (STARTER_HR_RATE - r.y) ** 2, 0) / rows.length
    : 1;
  const hi = rows.filter((r) => r.pHr >= 0.16);
  return {
    key,
    label,
    from: days[days.length - 1]?.date ?? "",
    to: days[0]?.date ?? "",
    days: days.length,
    looks: rows.length,
    top12Hits: top.reduce((s, r) => s + r.y, 0),
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
    baselineHits: base.reduce((s, r) => s + r.y, 0),
    baselineLooks: base.length,
    cut16Rate: rate(hi),
    cut16N: hi.length,
    brier,
    skill: brierRef > 0 ? 1 - brier / brierRef : 0,
  };
}

function rate(rows: Array<{ y: 0 | 1 }>): number {
  if (rows.length === 0) return 0;
  return rows.reduce((s, r) => s + r.y, 0) / rows.length;
}

function brierOf(rows: Array<{ pHr: number; y: 0 | 1 }>): number {
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
  try {
    const res = await fetch(
      `${MLB}/api/v1/schedule?sportId=1&startDate=${start}&endDate=${end}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as {
      dates?: Array<{
        date: string;
        games?: Array<{ status?: { abstractGameState?: string } }>;
      }>;
    };
    const dates: string[] = [];
    for (const day of [...(data.dates ?? [])].sort((a, b) => b.date.localeCompare(a.date))) {
      const finals = (day.games ?? []).some((g) => (g.status?.abstractGameState ?? "").toLowerCase() === "final");
      if (finals) dates.push(day.date);
    }
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

void POOL;
