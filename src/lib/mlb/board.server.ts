import { dailyParkAir, parkHrFactor, PARK_HR_FACTOR, shrinkYearPark, TEAM_VENUE } from "./parks";
import { CAL_BANDS, MODEL_VERSION, scoreMatchup } from "./model";
import { buildHrSignal } from "./signal";
import { rankVulnerablePitchers } from "./vulnerable";
import { shiftISODate, todayISODateET } from "./format";
import { canLock, lockFromBoard, lockState, readLock, writeLock } from "./lock";
import { fetchSavant, fetchWeekContact, fetchPitchMatrix, fetchPitchersMatrix, alignPitchRows, barrelPct, ev100Flags, pitchFamily, tankFlags, weekShape } from "./savant";
import type { SavantPitcher } from "./savant";
import type {
  ArsenalPitch,
  BoardPayload,
  GameCard,
  GameStatusKind,
  LineupSource,
  PitcherInfo,
  PitchMatrix,
  PlayerPrediction,
  WeatherInfo,
} from "./types";

const MLB = "https://statsapi.mlb.com";

type CacheEntry<T> = { exp: number; val: T };
const cache = new Map<string, CacheEntry<unknown>>();

function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.val as T);
  return fn().then((val) => {
    cache.set(key, { exp: Date.now() + ttlMs, val });
    return val;
  });
}

/** Drop date-specific live keys so a user refresh can pick up posted cards. Locks stay. */
export function bustBoardCache(date: string) {
  for (const key of [...cache.keys()]) {
    if (
      key === `sked:${date}` ||
      key === `recentLu:${date}` ||
      key === `board:${MODEL_VERSION}:${date}` ||
      key === `board:${MODEL_VERSION}:sig2:${date}` ||
      key === `board:${MODEL_VERSION}:sig3:${date}` ||
      key === `board:${MODEL_VERSION}:sig4:${date}` ||
      key === `board:${MODEL_VERSION}:sig5:${date}` ||
      key === `board:${MODEL_VERSION}:sig6:${date}` ||
      key === `board:${MODEL_VERSION}:sig7:${date}` ||
      key === `board:${MODEL_VERSION}:sig8:${date}` ||
      key === `board:${MODEL_VERSION}:sig9:${date}` ||
      key === `board:${MODEL_VERSION}:sig10:${date}` ||
      key === `board:${MODEL_VERSION}:sig11:${date}` ||
      key === `board:${MODEL_VERSION}:sig12:${date}` ||
      key === `board:${MODEL_VERSION}:sig13:${date}` ||
      key === `board:${MODEL_VERSION}:sig14:${date}` ||
      key.startsWith("box:") ||
      key.startsWith("people:") ||
      key.startsWith("humid:") ||
      key.startsWith("nws:") ||
      key.startsWith("walk:")
    ) {
      cache.delete(key);
    }
  }
  void import("./walk-forward").then((m) => m.bustWalkForward()).catch(() => undefined);
}

async function mlb<T>(path: string): Promise<T> {
  const url = path.startsWith("http") ? path : `${MLB}${path}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`MLB Stats API ${res.status} for ${path}`);
  }
  return (await res.json()) as T;
}

type Hand = "L" | "R" | "S";

function asHand(code: unknown): Hand {
  if (code === "L" || code === "R" || code === "S") return code;
  return "R";
}

async function fetchHandSplits(
  season: number,
): Promise<Map<number, { vsL: { hr: number; pa: number; slg: string } | null; vsR: { hr: number; pa: number; slg: string } | null }>> {
  const map = new Map<
    number,
    { vsL: { hr: number; pa: number; slg: string } | null; vsR: { hr: number; pa: number; slg: string } | null }
  >();
  const data = await mlb<{
    stats?: Array<{
      splits?: Array<{
        player?: { id?: number };
        split?: { code?: string };
        stat?: Record<string, unknown>;
      }>;
    }>;
  }>(
    `/api/v1/stats?stats=statSplits&group=hitting&season=${season}&sitCodes=vl,vr&sportIds=1&limit=2000&playerPool=all`,
  );
  for (const s of data.stats?.[0]?.splits ?? []) {
    const id = s.player?.id;
    if (!id) continue;
    const row = map.get(id) ?? { vsL: null, vsR: null };
    const bit = {
      hr: num(s.stat?.homeRuns),
      pa: num(s.stat?.plateAppearances),
      slg: String(s.stat?.slg ?? ""),
    };
    if (s.split?.code === "vl") row.vsL = bit;
    if (s.split?.code === "vr") row.vsR = bit;
    map.set(id, row);
  }
  return map;
}

function statusKind(abstract?: string, detailed?: string): GameStatusKind {
  const a = (abstract ?? "").toLowerCase();
  const d = (detailed ?? "").toLowerCase();
  if (a === "final" || d.includes("final") || d.includes("completed")) return "final";
  if (a === "live" || d.includes("in progress") || d.includes("manager challenge")) {
    return "live";
  }
  if (a === "preview" || d.includes("scheduled") || d.includes("pre-game") || d.includes("warmup")) {
    return "preview";
  }
  return "other";
}

type MlbPerson = {
  id: number;
  fullName?: string;
  lastName?: string;
  batSide?: { code?: string };
  pitchHand?: { code?: string };
  primaryPosition?: { abbreviation?: string };
  stats?: Array<{
    group?: { displayName?: string };
    type?: { displayName?: string };
    splits?: Array<{
      stat?: Record<string, unknown> & {
        percentage?: number;
        type?: { code?: string; description?: string };
      };
    }>;
  }>;
};

type MlbLineupPlayer = {
  id: number;
  fullName?: string;
  lastName?: string;
  primaryPosition?: { abbreviation?: string };
};

type MlbGame = {
  gamePk: number;
  gameDate: string;
  officialDate?: string;
  status?: { abstractGameState?: string; detailedState?: string };
  venue?: { id?: number; name?: string };
  weather?: { condition?: string; temp?: string; wind?: string };
  teams?: {
    away?: MlbSide;
    home?: MlbSide;
  };
  lineups?: {
    homePlayers?: MlbLineupPlayer[];
    awayPlayers?: MlbLineupPlayer[];
  };
};

type MlbSide = {
  score?: number;
  team?: {
    id?: number;
    name?: string;
    abbreviation?: string;
    teamName?: string;
  };
  probablePitcher?: { id?: number; fullName?: string };
};

type HittingBits = {
  hr: number;
  pa: number;
  avg: string;
  slg: string;
  ops: string;
  abPerHr: string | null;
};

type PitchingBits = {
  hr: number;
  bf: number;
  hr9: number | null;
  kPct: number | null;
  whip: number | null;
  gs: number | null;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function parseHitting(stat: Record<string, unknown> | undefined): HittingBits {
  const hr = num(stat?.homeRuns);
  const pa = num(stat?.plateAppearances);
  return {
    hr,
    pa,
    avg: str(stat?.avg) || ".000",
    slg: str(stat?.slg) || ".000",
    ops: str(stat?.ops) || ".000",
    abPerHr: stat?.atBatsPerHomeRun != null ? String(stat.atBatsPerHomeRun) : null,
  };
}

function parsePitching(stat: Record<string, unknown> | undefined): PitchingBits {
  const hr9Raw = stat?.homeRunsPer9;
  const hr9 = hr9Raw == null ? null : num(hr9Raw);
  const bf = num(stat?.battersFaced);
  const so = num(stat?.strikeOuts);
  const whipRaw = stat?.whip;
  const whip = whipRaw == null || whipRaw === "" ? null : num(whipRaw);
  const gsRaw = num(stat?.gamesStarted);
  const gs = gsRaw > 0 ? gsRaw : null;
  return {
    hr: num(stat?.homeRuns),
    bf,
    hr9: hr9 != null && Number.isFinite(hr9) ? hr9 : null,
    kPct: bf >= 20 ? (100 * so) / bf : null,
    whip: whip != null && Number.isFinite(whip) ? whip : null,
    gs,
  };
}

function personStats(person: MlbPerson | undefined): {
  hitting: HittingBits;
  pitching: PitchingBits;
} {
  const hitting: HittingBits = {
    hr: 0,
    pa: 0,
    avg: ".000",
    slg: ".000",
    ops: ".000",
    abPerHr: null,
  };
  const pitching: PitchingBits = { hr: 0, bf: 0, hr9: null, kPct: null, whip: null, gs: null };
  if (!person?.stats) return { hitting, pitching };
  for (const block of person.stats) {
    const group = block.group?.displayName;
    const kind = block.type?.displayName;
    const stat = block.splits?.[0]?.stat;
    if (group === "hitting" && kind === "season") Object.assign(hitting, parseHitting(stat));
    if (group === "pitching" && kind === "season") Object.assign(pitching, parsePitching(stat));
  }
  return { hitting, pitching };
}

function isPitcherPos(abbr?: string): boolean {
  return abbr === "P" || abbr === "1";
}

async function fetchSchedule(date: string): Promise<MlbGame[]> {
  const data = await mlb<{ dates?: Array<{ games?: MlbGame[] }> }>(
    `/api/v1/schedule?sportId=1&date=${date}&hydrate=probablePitcher,venue,weather,lineups,team`,
  );
  return data.dates?.[0]?.games ?? [];
}

async function fetchRecentLineups(date: string): Promise<Map<number, MlbLineupPlayer[]>> {
  const start = shiftISODate(date, -4);
  const end = shiftISODate(date, -1);
  const data = await mlb<{ dates?: Array<{ date: string; games?: MlbGame[] }> }>(
    `/api/v1/schedule?sportId=1&startDate=${start}&endDate=${end}&hydrate=lineups,team`,
  );
  const latest = new Map<number, MlbLineupPlayer[]>();
  const dates = [...(data.dates ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  for (const day of dates) {
    for (const game of day.games ?? []) {
      const homeId = game.teams?.home?.team?.id;
      const awayId = game.teams?.away?.team?.id;
      const homeLu = (game.lineups?.homePlayers ?? []).filter(
        (p) => !isPitcherPos(p.primaryPosition?.abbreviation),
      );
      const awayLu = (game.lineups?.awayPlayers ?? []).filter(
        (p) => !isPitcherPos(p.primaryPosition?.abbreviation),
      );
      if (homeId && homeLu.length >= 7) latest.set(homeId, homeLu.slice(0, 9));
      if (awayId && awayLu.length >= 7) latest.set(awayId, awayLu.slice(0, 9));
    }
  }
  return latest;
}

async function fetchLeagueRates(season: number): Promise<{ hrPa: number; hrBf: number }> {
  const [hit, pit] = await Promise.all([
    mlb<{ stats?: Array<{ splits?: Array<{ stat?: Record<string, unknown> }> }> }>(
      `/api/v1/teams/stats?season=${season}&group=hitting&stats=season&sportIds=1`,
    ),
    mlb<{ stats?: Array<{ splits?: Array<{ stat?: Record<string, unknown> }> }> }>(
      `/api/v1/teams/stats?season=${season}&group=pitching&stats=season&sportIds=1`,
    ),
  ]);
  let hr = 0;
  let pa = 0;
  for (const s of hit.stats?.[0]?.splits ?? []) {
    hr += num(s.stat?.homeRuns);
    pa += num(s.stat?.plateAppearances);
  }
  let phr = 0;
  let bf = 0;
  for (const s of pit.stats?.[0]?.splits ?? []) {
    phr += num(s.stat?.homeRuns);
    bf += num(s.stat?.battersFaced);
  }
  return {
    hrPa: pa > 0 ? hr / pa : 0.031,
    hrBf: bf > 0 ? phr / bf : 0.028,
  };
}

async function fetchLastXGames(
  season: number,
): Promise<Map<number, { hr: number; pa: number; games: number }>> {
  const map = new Map<number, { hr: number; pa: number; games: number }>();
  const data = await mlb<{
    stats?: Array<{
      splits?: Array<{
        player?: { id?: number };
        stat?: Record<string, unknown>;
      }>;
    }>;
  }>(
    `/api/v1/stats?stats=lastXGames&group=hitting&season=${season}&sportIds=1&gameType=R&sortStat=plateAppearances&order=desc&limit=250`,
  );
  for (const s of data.stats?.[0]?.splits ?? []) {
    const id = s.player?.id;
    if (!id) continue;
    map.set(id, {
      hr: num(s.stat?.homeRuns),
      pa: num(s.stat?.plateAppearances),
      games: num(s.stat?.gamesPlayed),
    });
  }
  return map;
}

async function fetchPeople(ids: number[], season: number): Promise<Map<number, MlbPerson>> {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  const map = new Map<number, MlbPerson>();
  if (unique.length === 0) return map;
  const chunkSize = 40;
  const chunks: number[][] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    chunks.push(unique.slice(i, i + chunkSize));
  }
  const pages = await Promise.all(
    chunks.map((chunk) =>
      mlb<{ people?: MlbPerson[] }>(
        `/api/v1/people?personIds=${chunk.join(",")}&hydrate=stats(group=[hitting,pitching],type=[season,pitchArsenal],season=${season})`,
      ),
    ),
  );
  for (const page of pages) {
    for (const p of page.people ?? []) {
      map.set(p.id, p);
    }
  }
  return map;
}

type BoxBits = {
  order: number[];
  hr: Map<number, number>;
  teamHr: { home: number; away: number };
};

async function fetchBoxscore(gamePk: number): Promise<BoxBits | null> {
  try {
    const box = await mlb<{
      teams?: {
        home?: {
          battingOrder?: number[];
          teamStats?: { batting?: { homeRuns?: number } };
          players?: Record<
            string,
            { person?: { id?: number }; stats?: { batting?: { homeRuns?: number } } }
          >;
        };
        away?: {
          battingOrder?: number[];
          teamStats?: { batting?: { homeRuns?: number } };
          players?: Record<
            string,
            { person?: { id?: number }; stats?: { batting?: { homeRuns?: number } } }
          >;
        };
      };
    }>(`/api/v1/game/${gamePk}/boxscore`);
    const hr = new Map<number, number>();
    const collect = (side: "home" | "away") => {
      const team = box.teams?.[side];
      for (const p of Object.values(team?.players ?? {})) {
        const id = p.person?.id;
        const h = p.stats?.batting?.homeRuns;
        if (id && h != null) hr.set(id, num(h));
      }
      return {
        order: team?.battingOrder ?? [],
        teamHr: num(team?.teamStats?.batting?.homeRuns),
      };
    };
    const home = collect("home");
    const away = collect("away");
    return {
      order: [...away.order, ...home.order],
      hr,
      teamHr: { home: home.teamHr, away: away.teamHr },
    };
  } catch {
    return null;
  }
}

function weatherOf(
  game: MlbGame,
  air?: { humidity: number | null; dewpoint: number | null } | null,
): WeatherInfo {
  return {
    temp: game.weather?.temp ?? null,
    wind: game.weather?.wind ?? null,
    condition: game.weather?.condition ?? null,
    humidity: air?.humidity ?? null,
    dewpoint: air?.dewpoint ?? null,
  };
}

type HumidBits = { humidity: number | null; dewpoint: number | null };

async function fetchHumidityMap(games: MlbGame[]): Promise<Map<number, HumidBits>> {
  const ids = [
    ...new Set(games.map((g) => g.venue?.id).filter((id): id is number => typeof id === "number" && id > 0)),
  ];
  const out = new Map<number, HumidBits>();
  if (ids.length === 0) return out;
  try {
    const data = await mlb<{
      venues?: Array<{
        id?: number;
        location?: { defaultCoordinates?: { latitude?: number; longitude?: number } };
      }>;
    }>(`/api/v1/venues?venueIds=${ids.join(",")}&hydrate=location`);
    const venues = data.venues ?? [];
    const byVenue = new Map(games.map((g) => [g.venue?.id ?? 0, g.gameDate]));
    const pool = 4;
    for (let i = 0; i < venues.length; i += pool) {
      const batch = venues.slice(i, i + pool);
      const rows = await Promise.all(
        batch.map(async (v) => {
          const id = v.id;
          const lat = v.location?.defaultCoordinates?.latitude;
          const lon = v.location?.defaultCoordinates?.longitude;
          if (!id || lat == null || lon == null) return null;
          const bits = await nwsHumidity(lat, lon, byVenue.get(id) ?? null);
          return bits ? ([id, bits] as const) : null;
        }),
      );
      for (const row of rows) {
        if (row) out.set(row[0], row[1]);
      }
    }
  } catch {
    /* NWS is optional */
  }
  return out;
}

async function nwsHumidity(lat: number, lon: number, gameIso: string | null): Promise<HumidBits | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  try {
    const points = await cached(`nws:pt:${key}`, 24 * 60 * 60_000, async () => {
      const res = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, {
        headers: { Accept: "application/geo+json", "User-Agent": "MoonshotHR/1.0" },
      });
      if (!res.ok) throw new Error(`nws points ${res.status}`);
      const data = (await res.json()) as { properties?: { forecastHourly?: string } };
      const url = data.properties?.forecastHourly;
      if (!url) throw new Error("no hourly");
      return url;
    });
    const hourly = await cached(`nws:hr:${points}`, 45 * 60_000, async () => {
      const res = await fetch(points, {
        headers: { Accept: "application/geo+json", "User-Agent": "MoonshotHR/1.0" },
      });
      if (!res.ok) throw new Error(`nws hourly ${res.status}`);
      return (await res.json()) as {
        properties?: {
          periods?: Array<{
            startTime?: string;
            relativeHumidity?: { value?: number };
            dewpoint?: { value?: number };
          }>;
        };
      };
    });
    const periods = hourly.properties?.periods ?? [];
    if (periods.length === 0) return null;
    const target = gameIso ? Date.parse(gameIso) : Date.now();
    let best = periods[0];
    let bestDist = Infinity;
    for (const p of periods) {
      const t = p.startTime ? Date.parse(p.startTime) : NaN;
      if (!Number.isFinite(t)) continue;
      const d = Math.abs(t - target);
      if (d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    const rh = best.relativeHumidity?.value;
    const dewC = best.dewpoint?.value;
    return {
      humidity: rh != null && Number.isFinite(rh) ? rh : null,
      dewpoint: dewC != null && Number.isFinite(dewC) ? (dewC * 9) / 5 + 32 : null,
    };
  } catch {
    return null;
  }
}

function pitcherInfo(
  person: MlbPerson | undefined,
  fallbackName: string,
  savant?: SavantPitcher | null,
): PitcherInfo | null {
  if (!person && !fallbackName) return null;
  const bits = personStats(person);
  const mix = parseMix(person);
  return {
    id: person?.id ?? 0,
    name: person?.fullName ?? fallbackName,
    throws: asHand(person?.pitchHand?.code),
    hr9: bits.pitching.hr9,
    hr: bits.pitching.bf ? bits.pitching.hr : null,
    bf: bits.pitching.bf || null,
    hardPct: mix.hardPct,
    breakPct: mix.breakPct,
    offPct: mix.offPct,
    mixFamily: mix.mixFamily,
    mixLabel: mix.mixLabel,
    arsenal: mix.arsenal,
    inZone: savant?.inZone ?? null,
    edge: savant?.edge ?? null,
    kPct: bits.pitching.kPct ?? savant?.kPct ?? null,
    whiffPct: savant?.whiff ?? null,
    whip: bits.pitching.whip,
    gs: bits.pitching.gs,
    tbfPerStart:
      bits.pitching.gs != null && bits.pitching.gs > 0 && bits.pitching.bf > 0
        ? bits.pitching.bf / bits.pitching.gs
        : null,
  };
}

function makePitchMatrix(
  mx: Awaited<ReturnType<typeof fetchPitchMatrix>>,
  pitcher: PitcherInfo | null,
  batterId: number,
): PitchMatrix | null {
  const pitSlices = pitcher ? mx.pitchers.get(pitcher.id) : undefined;
  const hitSlices = mx.batters.get(batterId);
  const pitcherRows = alignPitchRows(pitcher?.arsenal ?? null, pitSlices, true);
  const order = pitcherRows.map((r) => ({ code: r.code, pct: r.pct }));
  const hitterRows = alignPitchRows(order.length ? order : null, hitSlices, false);
  if (pitcherRows.length === 0 && hitterRows.length === 0) return null;
  return {
    from: mx.from,
    to: shiftISODate(mx.to, -1),
    pitcher: pitcherRows,
    hitter: hitterRows,
  };
}

function parseMix(person: MlbPerson | undefined): {
  hardPct: number | null;
  breakPct: number | null;
  offPct: number | null;
  mixFamily: PitcherInfo["mixFamily"];
  mixLabel: string | null;
  arsenal: ArsenalPitch[] | null;
} {
  const empty = {
    hardPct: null,
    breakPct: null,
    offPct: null,
    mixFamily: null,
    mixLabel: null,
    arsenal: null,
  };
  const block = person?.stats?.find((s) => s.type?.displayName === "pitchArsenal");
  const splits = block?.splits ?? [];
  if (splits.length === 0) return empty;
  let hard = 0;
  let brk = 0;
  let off = 0;
  const raw: Record<string, number> = {};
  for (const s of splits) {
    const code = String(s.stat?.type?.code ?? "").toUpperCase();
    const pct = Number(s.stat?.percentage ?? 0);
    if (!code || !Number.isFinite(pct) || pct <= 0) continue;
    raw[code] = (raw[code] ?? 0) + pct;
    const fam = pitchFamily(code);
    if (fam === "hard") hard += pct;
    else if (fam === "break") brk += pct;
    else if (fam === "off") off += pct;
  }
  const total = hard + brk + off;
  if (total < 0.4) return empty;
  const hardPct = hard / Math.max(total, 0.01);
  const breakPct = brk / Math.max(total, 0.01);
  const offPct = off / Math.max(total, 0.01);
  const mixFamily: PitcherInfo["mixFamily"] =
    hardPct >= 0.48 ? "hard" : breakPct >= offPct ? "break" : "off";
  const second =
    mixFamily === "off"
      ? `${Math.round(offPct * 100)}% off`
      : `${Math.round(breakPct * 100)}% break`;
  const sum = Object.values(raw).reduce((s, n) => s + n, 0);
  const arsenal: ArsenalPitch[] =
    sum > 0
      ? Object.entries(raw)
          .map(([code, pct]) => ({ code, pct: pct / sum }))
          .sort((a, b) => b.pct - a.pct)
      : [];
  return {
    hardPct,
    breakPct,
    offPct,
    mixFamily,
    mixLabel: `${Math.round(hardPct * 100)}% hard · ${second}`,
    arsenal: arsenal.length ? arsenal : null,
  };
}

async function fetchYearPark(season: number): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  try {
    const data = await mlb<{
      stats?: Array<{
        splits?: Array<{
          team?: { id?: number };
          split?: { code?: string };
          stat?: Record<string, unknown>;
        }>;
      }>;
    }>(
      `/api/v1/teams/stats?season=${season}&group=hitting&stats=statSplits&sitCodes=h,a&sportIds=1&limit=100`,
    );
    type Row = { hr: number; pa: number };
    const byTeam = new Map<number, { h: Row; a: Row }>();
    let lgH = { hr: 0, pa: 0 };
    let lgA = { hr: 0, pa: 0 };
    for (const s of data.stats?.[0]?.splits ?? []) {
      const id = s.team?.id;
      if (!id) continue;
      const bit = { hr: num(s.stat?.homeRuns), pa: num(s.stat?.plateAppearances) };
      const row = byTeam.get(id) ?? { h: { hr: 0, pa: 0 }, a: { hr: 0, pa: 0 } };
      if (s.split?.code === "h") {
        row.h = bit;
        lgH.hr += bit.hr;
        lgH.pa += bit.pa;
      } else if (s.split?.code === "a") {
        row.a = bit;
        lgA.hr += bit.hr;
        lgA.pa += bit.pa;
      }
      byTeam.set(id, row);
    }
    const lgRatio =
      lgH.pa > 0 && lgA.pa > 0 && lgA.hr > 0 ? lgH.hr / lgH.pa / (lgA.hr / lgA.pa) : 1;
    for (const [teamId, row] of byTeam) {
      const venueId = TEAM_VENUE[teamId];
      if (!venueId) continue;
      if (row.h.pa < 200 || row.a.pa < 200 || row.a.hr < 5) continue;
      const ratio = row.h.hr / row.h.pa / (row.a.hr / row.a.pa);
      const raw = 100 * (ratio / Math.max(lgRatio, 0.5));
      const three = PARK_HR_FACTOR[venueId] ?? 100;
      const pa = Math.min(row.h.pa, row.a.pa);
      map.set(venueId, shrinkYearPark(three, raw, pa));
    }
  } catch {
    return map;
  }
  return map;
}

export async function loadBoard(dateInput?: string): Promise<BoardPayload> {
  const date = dateInput && /^\d{4}-\d{2}-\d{2}$/.test(dateInput) ? dateInput : todayISODateET();
  const today = todayISODateET();
  const isToday = date === today;
  const isPast = date < today;
  const ttl = isToday ? 90_000 : isPast ? 30 * 60_000 : 3 * 60_000;
  const built = await cached(`board:${MODEL_VERSION}:sig14:${date}`, ttl, () => buildBoard(date));
  return sealBoard(built);
}

function sealBoard(built: BoardPayload): BoardPayload {
  const predictions = built.predictions.map((p) => ({ ...p }));
  const games = built.games;
  let lock = readLock(built.date);
  if (!lock && canLock(built)) {
    lock = writeLock(
      lockFromBoard({
        ...built,
        predictions: [...predictions].sort((a, b) => b.pHr - a.pHr),
      }),
    );
  }
  if (lock) {
    const byKey = new Map(lock.looks.map((l) => [`${l.playerId}:${l.gamePk}`, l] as const));
    for (const p of predictions) {
      const hit = byKey.get(`${p.playerId}:${p.gamePk}`);
      if (hit) {
        p.pHr = hit.pHr;
        p.pHrRaw = hit.pHrRaw;
      }
    }
  }
  predictions.sort((a, b) => b.pHr - a.pHr);
  const byLook = new Map(predictions.map((p) => [`${p.playerId}:${p.gamePk}`, p] as const));
  const vulnerable = (built.vulnerable ?? []).map((v) => ({
    ...v,
    targets: v.targets
      .map((t) => {
        const hit = byLook.get(`${t.playerId}:${t.gamePk}`);
        return hit ? { ...t, pHr: hit.pHr, grade: hit.signal.grade } : t;
      })
      .sort((a, b) => b.pHr - a.pHr),
  }));
  return {
    ...built,
    predictions,
    games,
    vulnerable,
    lock: lockState(built, lock),
    walkForward: null,
    summary: makeSummary(predictions, games),
  };
}

function makeSummary(
  predictions: PlayerPrediction[],
  gameCards: GameCard[],
): BoardPayload["summary"] {
  const completedGames = gameCards.filter((g) => g.status === "final").length;
  const liveGames = gameCards.filter((g) => g.status === "live").length;
  const officialLineups = gameCards.filter((g) => g.lineupSource === "official").length;
  const top12 = predictions.slice(0, 12);
  const top12WithHr =
    completedGames + liveGames > 0
      ? top12.filter((p) => (p.actualHr ?? 0) > 0).length
      : null;
  const meanP =
    predictions.length > 0
      ? predictions.reduce((s, p) => s + p.pHr, 0) / predictions.length
      : 0;
  const top12MeanP =
    top12.length > 0 ? top12.reduce((s, p) => s + p.pHr, 0) / top12.length : 0;
  const actualHrLeaders = predictions
    .filter((p) => (p.actualHr ?? 0) > 0)
    .sort((a, b) => (b.actualHr ?? 0) - (a.actualHr ?? 0) || b.pHr - a.pHr)
    .slice(0, 8)
    .map((p) => ({
      playerId: p.playerId,
      name: p.name,
      teamAbbr: p.teamAbbr,
      actualHr: p.actualHr ?? 0,
      pHr: p.pHr,
    }));

  const graded = predictions.filter((p) => p.actualHr != null);
  const hit = (p: PlayerPrediction) => (p.actualHr ?? 0) > 0;
  const actualRate = graded.length > 0 ? graded.filter(hit).length / graded.length : null;
  const top12Graded = top12.filter((p) => p.actualHr != null);
  const restGraded = graded.filter(
    (p) => !top12.some((t) => t.playerId === p.playerId && t.gamePk === p.gamePk),
  );
  const top12Rate =
    top12Graded.length > 0 ? top12Graded.filter(hit).length / top12Graded.length : null;
  const restRate = restGraded.length > 0 ? restGraded.filter(hit).length / restGraded.length : null;
  const brier =
    graded.length > 0
      ? graded.reduce((s, p) => {
          const y = hit(p) ? 1 : 0;
          return s + (p.pHr - y) ** 2;
        }, 0) / graded.length
      : null;
  const calibration =
    graded.length > 0
      ? CAL_BANDS.map((b) => {
          const rows = graded.filter((p) => p.pHr >= b.min && p.pHr < b.max);
          return {
            label: b.label,
            n: rows.length,
            meanP: rows.length ? rows.reduce((s, p) => s + p.pHr, 0) / rows.length : 0,
            actualRate: rows.length
              ? rows.filter((p) => (p.actualHr ?? 0) > 0).length / rows.length
              : 0,
          };
        }).filter((b) => b.n > 0)
      : [];

  return {
    games: gameCards.length,
    modeled: predictions.length,
    officialLineups,
    projectedLineups: gameCards.length - officialLineups,
    completedGames,
    liveGames,
    top12WithHr,
    meanP,
    top12MeanP,
    actualRate,
    top12Rate,
    restRate,
    actualHrLeaders,
    brier,
    calibration,
  };
}

async function buildBoard(date: string): Promise<BoardPayload> {
  const season = Number(date.slice(0, 4));
  const today = todayISODateET();
  const isToday = date === today;
  const isPast = date < today;

  const ttlSchedule = isToday ? 90_000 : isPast ? 30 * 60_000 : 3 * 60_000;
  const ttlSlow = 20 * 60_000;

  const weekFrom = shiftISODate(date, -10);
  const weekTo = date;
  const mxFrom = shiftISODate(today, -45);
  const mxTo = shiftISODate(today, 1);
  const [games, recentLineups, league, recentMap, savant, weekMap, handSplits, yearPark, pitchMx] =
    await Promise.all([
      cached(`sked:${date}`, ttlSchedule, () => fetchSchedule(date)),
      cached(`recentLu:${date}`, ttlSlow, () => fetchRecentLineups(date)),
      cached(`league:${season}`, ttlSlow, () => fetchLeagueRates(season)),
      cached(`l10:${season}`, ttlSlow, () => fetchLastXGames(season)),
      cached(`savant:v6:${season}`, 45 * 60_000, () => fetchSavant(season)),
      cached(`week:v7:${weekFrom}:${weekTo}`, 30 * 60_000, () => fetchWeekContact(season, weekFrom, weekTo)),
      cached(`splits:${season}`, 45 * 60_000, () => fetchHandSplits(season)),
      cached(`parkYear:v1:${season}`, 45 * 60_000, () => fetchYearPark(season)),
      cached(`pitchMx:v1:${mxFrom}:${mxTo}`, 60 * 60_000, () => fetchPitchMatrix(mxFrom, mxTo, season)),
    ]);

  type ResolvedGame = {
    game: MlbGame;
    status: GameStatusKind;
    statusLabel: string;
    lineupSource: LineupSource;
    awayLu: MlbLineupPlayer[];
    homeLu: MlbLineupPlayer[];
  };

  const resolved: ResolvedGame[] = games.map((game) => {
    const status = statusKind(game.status?.abstractGameState, game.status?.detailedState);
    const statusLabel = game.status?.detailedState ?? "Scheduled";
    const awayId = game.teams?.away?.team?.id;
    const homeId = game.teams?.home?.team?.id;
    const officialAway = (game.lineups?.awayPlayers ?? []).filter(
      (p) => !isPitcherPos(p.primaryPosition?.abbreviation),
    );
    const officialHome = (game.lineups?.homePlayers ?? []).filter(
      (p) => !isPitcherPos(p.primaryPosition?.abbreviation),
    );
    const hasOfficial = officialAway.length >= 7 && officialHome.length >= 7;
    const awayLu = hasOfficial
      ? officialAway.slice(0, 9)
      : (awayId ? recentLineups.get(awayId) : undefined)?.slice(0, 9) ?? [];
    const homeLu = hasOfficial
      ? officialHome.slice(0, 9)
      : (homeId ? recentLineups.get(homeId) : undefined)?.slice(0, 9) ?? [];
    return {
      game,
      status,
      statusLabel,
      lineupSource: hasOfficial ? "official" : "projected",
      awayLu,
      homeLu,
    };
  });

  const peopleIds: number[] = [];
  const liveOrFinalPks: number[] = [];
  for (const g of resolved) {
    for (const p of [...g.awayLu, ...g.homeLu]) peopleIds.push(p.id);
    const ap = g.game.teams?.away?.probablePitcher?.id;
    const hp = g.game.teams?.home?.probablePitcher?.id;
    if (ap) peopleIds.push(ap);
    if (hp) peopleIds.push(hp);
    if (g.status === "live" || g.status === "final") liveOrFinalPks.push(g.game.gamePk);
  }

  const peopleKey = `people:ars:${season}:${[...new Set(peopleIds)].sort((a, b) => a - b).join(",")}`;
  const [people, boxes, humidityMap] = await Promise.all([
    cached(peopleKey, ttlSlow, () => fetchPeople(peopleIds, season)),
    Promise.all(
      liveOrFinalPks.map(async (pk) => {
        const ttl = resolved.find((g) => g.game.gamePk === pk)?.status === "final" ? 15 * 60_000 : 60_000;
        const box = await cached(`box:${pk}`, ttl, () => fetchBoxscore(pk));
        return [pk, box] as const;
      }),
    ),
    cached(`humid:v1:${date}`, isToday ? 45 * 60_000 : 30 * 60_000, () => fetchHumidityMap(games)),
  ]);
  const boxMap = new Map(boxes);

  const starterIds = [
    ...new Set(
      resolved.flatMap((g) =>
        [g.game.teams?.away?.probablePitcher?.id, g.game.teams?.home?.probablePitcher?.id].filter(
          (id): id is number => typeof id === "number" && id > 0,
        ),
      ),
    ),
  ];
  const thinStarters = starterIds.filter((id) => {
    const rows = pitchMx.pitchers.get(id);
    const n = rows?.reduce((s, r) => s + r.n, 0) ?? 0;
    return n < 8;
  });
  if (thinStarters.length > 0) {
    const extra = await cached(`pitMxP:v2:${season}:${thinStarters.slice().sort((a, b) => a - b).join(",")}`, 60 * 60_000, () =>
      fetchPitchersMatrix(thinStarters, "2026-03-25", mxTo, season),
    );
    for (const [id, rows] of extra) pitchMx.pitchers.set(id, rows);
  }

  const predictions: PlayerPrediction[] = [];
  const gameCards: GameCard[] = [];

  for (const g of resolved) {
    const game = g.game;
    const venueId = game.venue?.id ?? 0;
    const venueName = game.venue?.name ?? "Unknown park";
    const weather = weatherOf(game, humidityMap.get(venueId) ?? null);
    const yearBase = yearPark.get(venueId) ?? null;
    const gameAir = dailyParkAir(
      venueId,
      undefined,
      weather.temp,
      weather.wind,
      weather.condition,
      yearBase,
      weather.humidity,
      weather.dewpoint,
    );
    const park = {
      id: venueId,
      name: venueName,
      hrFactor: parkHrFactor(venueId, undefined, yearBase),
      airIndex: gameAir.index,
      deltaHr: gameAir.deltaHr,
      airLabel: gameAir.label,
    };
    const awayTeam = game.teams?.away?.team;
    const homeTeam = game.teams?.home?.team;
    const awayPitcherPerson = game.teams?.away?.probablePitcher?.id
      ? people.get(game.teams.away.probablePitcher.id)
      : undefined;
    const homePitcherPerson = game.teams?.home?.probablePitcher?.id
      ? people.get(game.teams.home.probablePitcher.id)
      : undefined;
    const awayPitSavant = game.teams?.away?.probablePitcher?.id
      ? savant.pitchers.get(game.teams.away.probablePitcher.id)
      : undefined;
    const homePitSavant = game.teams?.home?.probablePitcher?.id
      ? savant.pitchers.get(game.teams.home.probablePitcher.id)
      : undefined;
    const awayPitcher = pitcherInfo(
      awayPitcherPerson,
      game.teams?.away?.probablePitcher?.fullName ?? "",
      awayPitSavant,
    );
    const homePitcher = pitcherInfo(
      homePitcherPerson,
      game.teams?.home?.probablePitcher?.fullName ?? "",
      homePitSavant,
    );
    const box = boxMap.get(game.gamePk) ?? null;

    const pushSide = (
      lineup: MlbLineupPlayer[],
      team: MlbSide["team"],
      opponent: MlbSide["team"],
      isHome: boolean,
      opposingPitcher: PitcherInfo | null,
    ) => {
      lineup.forEach((lu, idx) => {
        const person = people.get(lu.id);
        const { hitting } = personStats(person);
        const recent = recentMap.get(lu.id) ?? null;
        const order = idx + 1;
        const bats = asHand(person?.batSide?.code);
        const batSavant = savant.batters.get(lu.id) ?? null;
        const pitSavant = opposingPitcher ? savant.pitchers.get(opposingPitcher.id) ?? null : null;
        const week = weekMap.get(lu.id) ?? null;
        const splits = handSplits.get(lu.id) ?? null;
        const ev100 = ev100Flags(week);
        const tanks = tankFlags(week);
        const shape = weekShape(week);
        const mx = makePitchMatrix(pitchMx, opposingPitcher, lu.id);
        const scored = scoreMatchup({
          batterHr: hitting.hr,
          batterPa: hitting.pa,
          recentHr: recent?.hr ?? null,
          recentPa: recent?.pa ?? null,
          pitcherHr: opposingPitcher?.hr ?? null,
          pitcherBf: opposingPitcher?.bf ?? null,
          bats,
          throws: opposingPitcher?.throws ?? null,
          venueId,
          temp: weather.temp,
          wind: weather.wind,
          order,
          leagueHrPa: league.hrPa,
          leagueHrBf: league.hrBf,
          lineupSource: g.lineupSource,
          savant: batSavant,
          pitcherSavant: pitSavant,
          savantLeague: savant.league,
          week,
          vsL: splits?.vsL ?? null,
          vsR: splits?.vsR ?? null,
          pitcherHardPct: opposingPitcher?.hardPct ?? null,
          pitcherBreakPct: opposingPitcher?.breakPct ?? null,
          pitcherOffPct: opposingPitcher?.offPct ?? null,
          pitcherArsenal: opposingPitcher?.arsenal ?? null,
          pitcherKPct: opposingPitcher?.kPct ?? pitSavant?.kPct ?? null,
          pitcherGs: opposingPitcher?.gs ?? null,
          pitcherMatrix: mx?.pitcher ?? null,
          hitterMatrix: mx?.hitter ?? null,
          yearPark: yearBase,
          condition: weather.condition,
          humidity: weather.humidity,
          dewpoint: weather.dewpoint,
        });
        const actual = box?.hr.get(lu.id);
        predictions.push({
          playerId: lu.id,
          name: person?.fullName ?? lu.fullName ?? "Unknown",
          lastName: person?.lastName ?? lu.lastName ?? "",
          teamId: team?.id ?? 0,
          teamAbbr: team?.abbreviation ?? "MLB",
          opponentId: opponent?.id ?? 0,
          opponentAbbr: opponent?.abbreviation ?? "MLB",
          isHome,
          gamePk: game.gamePk,
          gameStatus: g.status,
          gameStatusLabel: g.statusLabel,
          gameTime: game.gameDate,
          battingOrder: order,
          position: lu.primaryPosition?.abbreviation ?? person?.primaryPosition?.abbreviation ?? "DH",
          bats,
          pitcher: opposingPitcher,
          park: {
            id: venueId,
            name: venueName,
            hrFactor: Math.round(scored.factors.park.value * 100),
            airIndex: Math.round(scored.factors.park.value * 100),
            deltaHr: (scored.factors.park.value * 100 - 100) / 40,
            airLabel: scored.factors.park.label,
          },
          weather,
          lineupSource: g.lineupSource,
          ...scored,
          season: hitting,
          recent,
          actualHr: actual == null ? null : actual,
          statcast: batSavant
            ? {
                barrel: batSavant.barrel,
                ev: batSavant.ev,
                hardHit: batSavant.hardHit,
                xIso: batSavant.xIso,
                pull: batSavant.pull,
                flyBall: batSavant.flyBall,
                launch: batSavant.launch,
                swingSpeed: batSavant.swingSpeed,
                attackAngle: batSavant.attackAngle,
                solid: batSavant.solid,
                xSlg: batSavant.xSlg,
                kPct: batSavant.kPct,
                whiff: batSavant.whiff,
                sweetSpot: batSavant.sweetSpot,
                blast: batSavant.blast,
                squaredUp: batSavant.squaredUp,
              }
            : null,
          week: week
            ? {
                bbe: week.bbe,
                barrels: week.barrels,
                barrelPct: barrelPct(week) ?? 0,
                ev: week.bbe ? week.evSum / week.bbe : null,
                batSpeed: week.batSpeedN ? week.batSpeedSum / week.batSpeedN : null,
                solidPct: week.bbe ? (100 * week.solid) / week.bbe : null,
                weakPct: week.bbe ? (100 * week.weak) / week.bbe : null,
                ev100Last1: ev100.last1,
                ev100Last3: ev100.last3,
                n100Last3: ev100.n100Last3,
                maxEvLast1: ev100.maxEvLast1,
                pullPct: shape.pullPct,
                pullAirPct: shape.pullAirPct,
                idealAaPct: shape.idealAaPct,
                launchBandLast3: shape.launchBandLast3,
                launchBandLast5: shape.launchBandLast5,
                nLaunchBandLast5: shape.nLaunchBandLast5,
                tanks: tanks.count,
                tanksLast1: tanks.last1,
                tanksLast3: tanks.last3,
                vsL: {
                  bbe: week.vsL.bbe,
                  barrels: week.vsL.barrels,
                  pct: barrelPct(week.vsL),
                },
                vsR: {
                  bbe: week.vsR.bbe,
                  barrels: week.vsR.barrels,
                  pct: barrelPct(week.vsR),
                },
                vsHard: {
                  bbe: week.vsHard.bbe,
                  barrels: week.vsHard.barrels,
                  pct: barrelPct(week.vsHard),
                },
                vsBreak: {
                  bbe: week.vsBreak.bbe,
                  barrels: week.vsBreak.barrels,
                  pct: barrelPct(week.vsBreak),
                },
                vsOff: {
                  bbe: week.vsOff.bbe,
                  barrels: week.vsOff.barrels,
                  pct: barrelPct(week.vsOff),
                },
                heart: {
                  bbe: week.heart.bbe,
                  barrels: week.heart.barrels,
                  pct: barrelPct(week.heart),
                },
                chase: {
                  bbe: week.chase.bbe,
                  barrels: week.chase.barrels,
                  pct: barrelPct(week.chase),
                },
                vsPitch: Object.entries(week.byPitch)
                  .map(([code, side]) => ({
                    code,
                    bbe: side.bbe,
                    barrels: side.barrels,
                    pct: barrelPct(side),
                  }))
                  .sort((a, b) => b.bbe - a.bbe)
                  .slice(0, 6),
              }
            : null,
          handSplit: splits,
          pitchMatrix: mx,
          signal: {
            grade: "thin",
            passed: 0,
            total: 8,
            score: 0,
            headline: "",
            why: "",
            missing: null,
            keyMatch: null,
            checks: [],
          },
        });
      });
    };

    pushSide(g.awayLu, awayTeam, homeTeam, false, homePitcher);
    pushSide(g.homeLu, homeTeam, awayTeam, true, awayPitcher);

    const sidePreds = predictions.filter((p) => p.gamePk === game.gamePk);
    const combinedXhr = sidePreds.reduce((s, p) => s + p.xHr, 0);
    const actualHr =
      box != null ? box.teamHr.home + box.teamHr.away : g.status === "preview" ? null : null;

    gameCards.push({
      gamePk: game.gamePk,
      gameTime: game.gameDate,
      status: g.status,
      statusLabel: g.statusLabel,
      venueName,
      park,
      weather,
      away: {
        id: awayTeam?.id ?? 0,
        abbr: awayTeam?.abbreviation ?? "AWAY",
        name: awayTeam?.teamName ?? awayTeam?.name ?? "Away",
        pitcher: awayPitcher,
        score: game.teams?.away?.score ?? null,
      },
      home: {
        id: homeTeam?.id ?? 0,
        abbr: homeTeam?.abbreviation ?? "HOME",
        name: homeTeam?.teamName ?? homeTeam?.name ?? "Home",
        pitcher: homePitcher,
        score: game.teams?.home?.score ?? null,
      },
      lineupSource: g.lineupSource,
      combinedXhr,
      actualHr,
    });
  }

  predictions.sort((a, b) => b.pHr - a.pHr);
  for (const p of predictions) p.signal = buildHrSignal(p);
  const sortedGames = gameCards.sort((a, b) => a.gameTime.localeCompare(b.gameTime));
  const vulnerable = rankVulnerablePitchers(sortedGames, predictions, savant.pitchers);

  return {
    date,
    season,
    generatedAt: new Date().toISOString(),
    league,
    games: sortedGames,
    predictions,
    vulnerable,
    lock: { status: "open", at: null, model: MODEL_VERSION, note: "" },
    walkForward: null,
    summary: makeSummary(predictions, sortedGames),
  };
}
