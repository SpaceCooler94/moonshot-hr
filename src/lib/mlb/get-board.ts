import { createServerFn } from "@tanstack/react-start";
import { isISODate } from "./http.ts";
import { gradeLook } from "./look.ts";
import type { BoardPayload, PlayerOdds, PlayerPrediction, WalkForward } from "./types.ts";

export const ODDS_KEY_LS = "moonshot.oddsKey";
export const SGO_KEY_LS = "moonshot.sgoKey";

function keyOk(k: string): boolean {
  return k.length >= 8 && k.length <= 200 && !/\s/.test(k);
}
let lastFillAt = 0;
let lastBustAt = 0;
let lastOdds: {
  date: string;
  at: number;
  payload: { byId: Record<string, PlayerOdds>; n: number; remaining: number | null; source: "sgo" | "odds" | "none" };
} | null = null;

function dateOf(raw: unknown, fallback: string): string {
  return isISODate(raw) ? raw : fallback;
}

function asDate(data: { date?: string }): { date?: string } {
  if (data.date != null && !isISODate(data.date)) throw new Error("bad date");
  return data;
}

export const getBoard = createServerFn({ method: "GET" })
  .validator((data: { date?: string }) => asDate(data))
  .handler(async ({ data }): Promise<BoardPayload> => {
    const { loadBoard } = await import("./board.server");
    const { todayISODateET } = await import("./format");
    const date = dateOf(data.date, todayISODateET());
    try {
      const full = loadBoard(date);
      const timed = await Promise.race([
        full.then((b) => ({ ok: true as const, board: b })),
        new Promise<{ ok: false }>((resolve) => setTimeout(() => resolve({ ok: false }), 18_000)),
      ]);
      if (timed.ok) return slimBoard(timed.board);
      const lean = await loadBoard(date, { lean: true });
      return slimBoard(lean);
    } catch {
      return emptyBoard(date);
    }
  });

export const getPlayer = createServerFn({ method: "GET" })
  .validator((data: { date?: string; playerId: number; gamePk: number }) => {
    asDate(data);
    if (!Number.isFinite(data.playerId) || !Number.isFinite(data.gamePk)) throw new Error("bad player");
    return data;
  })
  .handler(async ({ data }): Promise<PlayerPrediction | null> => {
    const { loadBoard } = await import("./board.server");
    const { todayISODateET } = await import("./format");
    if (!Number.isFinite(data.playerId) || !Number.isFinite(data.gamePk)) return null;
    const board = await loadBoard(dateOf(data.date, todayISODateET()));
    return (
      board.predictions.find((p) => p.playerId === data.playerId && p.gamePk === data.gamePk) ??
      null
    );
  });

export const getWalkForward = createServerFn({ method: "GET" })
  .validator((data: { date?: string; fill?: boolean }) => data)
  .handler(async ({ data }): Promise<WalkForward | null> => {
    const { loadWalkForward } = await import("./walk-forward");
    const { todayISODateET } = await import("./format");
    const date = dateOf(data.date, todayISODateET());
    const fill = data.fill === true && Date.now() - lastFillAt > 20_000;
    if (fill) lastFillAt = Date.now();
    return loadWalkForward(date, { fill });
  });

export const getHrModel = createServerFn({ method: "GET" }).handler(async () => {
  const { readHrArtifact } = await import("./hr-serve");
  const { coeffTable } = await import("./hr-model");
  const art = readHrArtifact();
  if (!art) return null;
  return {
    version: art.version,
    trainedAt: art.trainedAt,
    lambda: art.lambda,
    cuts: art.cuts,
    metrics: art.metrics,
    coefficients: coeffTable(art),
    capWhy: art.cuts.capWhy,
  };
});

export const bustBoard = createServerFn({ method: "POST" })
  .validator((data: { date?: string }) => data)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { bustBoardCache } = await import("./board.server");
    const { todayISODateET } = await import("./format");
    const date = dateOf(data.date, todayISODateET());
    if (Date.now() - lastBustAt < 8_000) return { ok: true as const };
    lastBustAt = Date.now();
    bustBoardCache(date);
    return { ok: true as const };
  });

export const pullHrOdds = createServerFn({ method: "POST" })
  .validator((data: { date?: string; apiKey?: string; sgoKey?: string }) => data)
  .handler(async ({ data }): Promise<{ byId: Record<string, PlayerOdds>; n: number; remaining: number | null; source: "sgo" | "odds" | "none" }> => {
    const apiKey = (data.apiKey ?? "").trim();
    const sgoKey = (data.sgoKey ?? "").trim();
    const { loadBoard } = await import("./board.server");
    const { fetchHrOdds, attachLines, scoreEv, markTickets, oddsRemaining } = await import("./odds");
    const { fetchSgoHrOdds } = await import("./sgo");
    const { todayISODateET } = await import("./format");
    const date = dateOf(data.date, todayISODateET());
    if (lastOdds && lastOdds.date === date && lastOdds.payload.n > 0 && Date.now() - lastOdds.at < 90_000) {
      return lastOdds.payload;
    }
    const board = await loadBoard(date, { lean: true });
    const teams = new Set<string>();
    for (const p of board.predictions) {
      teams.add(p.teamAbbr);
      teams.add(p.opponentAbbr);
    }
    if (teams.size === 0) {
      return { byId: {}, n: 0, remaining: oddsRemaining(), source: "none" };
    }
    let map = new Map<string, PlayerOdds>();
    let source: "sgo" | "odds" | "none" = "none";
    if (keyOk(sgoKey)) {
      map = await fetchSgoHrOdds(date, sgoKey);
      if (map.size > 0) source = "sgo";
    }
    if (map.size === 0 && !keyOk(sgoKey) && keyOk(apiKey)) {
      map = await fetchHrOdds(date, apiKey, teams);
      if (map.size > 0) source = "odds";
    }
    if (map.size === 0) {
      const prev = lastOdds?.date === date ? lastOdds.payload : { byId: {}, n: 0, remaining: oddsRemaining(), source: "none" as const };
      return { ...prev, remaining: oddsRemaining() };
    }
    const preds = board.predictions.map((p) => ({ ...p }));
    attachLines(preds, map);
    scoreEv(preds);
    markTickets(preds);
    const byId: Record<string, PlayerOdds> = {};
    for (const p of preds) {
      if (p.odds?.lines.length) byId[`${p.playerId}:${p.gamePk}`] = p.odds;
    }
    const payload = { byId, n: Object.keys(byId).length, remaining: oddsRemaining(), source };
    lastOdds = { date, at: Date.now(), payload };
    return payload;
  });

function slimBoard(board: BoardPayload): BoardPayload {
  return {
    date: board.date,
    season: board.season,
    generatedAt: board.generatedAt,
    league: board.league,
    games: board.games.map((g) => ({
      ...g,
      penAway: null,
      penHome: null,
    })),
    predictions: board.predictions.map(slimPlayer),
    vulnerable: [],
    lock: board.lock,
    walkForward: null,
    summary: {
      ...board.summary,
      actualHrLeaders: (board.summary.actualHrLeaders ?? []).slice(0, 8),
      calibration: [],
    },
  };
}

const EMPTY_FORECAST = {
  score: 0,
  conf: 0,
  pRaw: 0,
  pContact: 0,
  pMatch: 0,
  pPark: 0,
  pGame: 0,
  p2plus: 0,
  xHr: 0,
  bars: [],
  driver: "",
  secondary: "",
  likes: [],
  risks: [],
};

const EMPTY_DECISION = {
  pass: false,
  score: 0,
  tags: [] as string[],
  missing: null as string | null,
  push: 0,
  line: "",
  tonight: [] as string[],
  bvp: 0,
  bvpGrade: "fade" as const,
  bvpLine: "",
  bvpLayers: [] as Array<{ key: string; pass: boolean; line: string }>,
  both20: false,
  mixHr: 0,
  yards: false,
  converge: 0,
  env: 0,
  kasper: "",
};

function slimPlayer(p: PlayerPrediction): PlayerPrediction {
  const g = gradeLook(p);
  return {
    playerId: p.playerId,
    name: p.name,
    lastName: p.lastName,
    teamId: p.teamId,
    teamAbbr: p.teamAbbr,
    opponentId: p.opponentId,
    opponentAbbr: p.opponentAbbr,
    isHome: p.isHome,
    gamePk: p.gamePk,
    gameStatus: p.gameStatus,
    gameStatusLabel: p.gameStatusLabel,
    gameTime: p.gameTime,
    battingOrder: p.battingOrder,
    position: p.position,
    bats: p.bats,
    pitcher: p.pitcher
      ? {
          id: p.pitcher.id,
          name: p.pitcher.name,
          throws: p.pitcher.throws,
          hr9: p.pitcher.hr9,
          hr: null,
          bf: null,
          hardPct: null,
          breakPct: null,
          offPct: null,
          mixFamily: null,
          mixLabel: null,
          arsenal: null,
          inZone: null,
          edge: null,
          kPct: null,
          whiffPct: null,
          whip: null,
          gs: null,
          tbfPerStart: null,
          stuff: null,
          penLine: null,
          likelyExit: false,
          starterPitches: null,
        }
      : null,
    park: p.park,
    weather: { temp: null, wind: null, condition: null, humidity: null, dewpoint: null },
    lineupSource: p.lineupSource,
    pHr: p.pHr,
    pHrRaw: p.pHrRaw,
    xHr: p.xHr,
    expectedPa: p.expectedPa,
    gamePa: p.gamePa,
    starterTbf: p.starterTbf,
    pHrPa: p.pHrPa,
    confidence: p.confidence,
    confidenceBand: p.confidenceBand,
    confidenceNotes: [],
    reasons: [],
    factors: {
      batter: { value: 1, label: "" },
      pitcher: { value: 1, label: "" },
      park: { value: 1, label: "" },
      platoon: { value: 1, label: "" },
      weather: { value: 1, label: "" },
      form: { value: 1, label: "" },
    },
    season: { hr: p.season.hr, pa: p.season.pa, avg: "", slg: "", ops: "", abPerHr: null },
    recent: null,
    actualHr: p.actualHr,
    statcast: p.statcast
      ? {
          barrel: p.statcast.barrel,
          ev: null,
          hardHit: null,
          xIso: null,
          pull: null,
          flyBall: null,
          launch: null,
          swingSpeed: null,
          attackAngle: null,
          solid: null,
          xSlg: null,
          kPct: null,
          whiff: null,
          sweetSpot: null,
          blast: null,
          squaredUp: null,
          barrelPa: null,
          hrFb: null,
        }
      : null,
    week: null,
    handSplit: null,
    pitchMatrix: null,
    signal: {
      grade: p.signal.grade,
      passed: p.signal.passed,
      total: p.signal.total,
      score: p.signal.score,
      headline: g.title,
      why: g.why,
      missing: null,
      keyMatch: null,
      checks: [],
      decision: EMPTY_DECISION,
    },
    forecast: EMPTY_FORECAST,
    odds: null,
    ticket: null,
    ticketWhy: null,
    book: null,
    splits: null,
    paSim: null,
    lookCall: g.call,
    lookWhy: g.why.slice(0, 160),
    lookBits: { power: g.power.on, mix: g.mix.on, park: g.park.on, order: g.order.on },
    lookScore: g.score,
  };
}

function emptyBoard(date: string): BoardPayload {
  return {
    date,
    season: Number(date.slice(0, 4)),
    generatedAt: new Date().toISOString(),
    league: { hrPa: 0.031, hrBf: 0.031, last7HrG: 1, seasonHrG: 1, carry: 1 },
    games: [],
    predictions: [],
    vulnerable: [],
    lock: { status: "open", at: null, model: "v16-fresh", note: "Board timed out. Pull to retry." },
    walkForward: null,
    summary: {
      games: 0,
      modeled: 0,
      officialLineups: 0,
      projectedLineups: 0,
      completedGames: 0,
      liveGames: 0,
      top12WithHr: null,
      meanP: 0,
      top12MeanP: 0,
      actualRate: null,
      top12Rate: null,
      restRate: null,
      hrN: null,
      capture12: null,
      cutN: null,
      cutHits: null,
      cutRate: null,
      captureCut: null,
      yardsN: null,
      yardsHits: null,
      yardsRate: null,
      brierSkill: null,
      actualHrLeaders: [],
      brier: null,
      calibration: [],
    },
  };
}
