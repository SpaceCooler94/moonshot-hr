import { juiceCall } from "./bvp.ts";
import { clamp, shrinkRate } from "./prob.ts";
import { fetchOk, pruneMap } from "./http.ts";
import type { BookId, BookLine, PlayerOdds, PlayerPrediction } from "./types";

const API = "https://api.the-odds-api.com/v4";
const BOOKS = [
  { api: "fanduel", id: "fd" as const, book: "FanDuel" },
  { api: "draftkings", id: "dk" as const, book: "DraftKings" },
  { api: "betmgm", id: "mg" as const, book: "BetMGM" },
  { api: "betrivers", id: "rv" as const, book: "BetRivers" },
  { api: "lowvig", id: "lv" as const, book: "LowVig" },
] as const;
const TAKE = new Set<BookId>(["fd", "dk", "cz", "b3"]);
const SHARP = new Set<BookId>(["pn", "cr", "lv", "bo", "be"]);
const MARKETS = "batter_home_runs,batter_home_runs_alternate";
const BOOK_KEYS = BOOKS.map((b) => b.api).join(",");

const TEAM_ALIAS: Record<string, string[]> = {
  AZ: ["AZ", "ARI"],
  ARI: ["AZ", "ARI"],
  CWS: ["CWS", "CHW"],
  CHW: ["CWS", "CHW"],
  WSH: ["WSH", "WAS"],
  WAS: ["WSH", "WAS"],
  ATH: ["ATH", "OAK"],
  OAK: ["ATH", "OAK"],
  SF: ["SF", "SFG"],
  SD: ["SD", "SDP"],
  TB: ["TB", "TBR"],
  KC: ["KC", "KCR"],
};

function teamsOf(abbr: string): string[] {
  return TEAM_ALIAS[abbr] ?? [abbr];
}

const TEAM_ABBR: Record<string, string> = {
  "arizona diamondbacks": "AZ",
  "atlanta braves": "ATL",
  athletics: "ATH",
  "oakland athletics": "ATH",
  "sacramento athletics": "ATH",
  "las vegas athletics": "ATH",
  "baltimore orioles": "BAL",
  "boston red sox": "BOS",
  "chicago cubs": "CHC",
  "chicago white sox": "CWS",
  "cincinnati reds": "CIN",
  "cleveland guardians": "CLE",
  "colorado rockies": "COL",
  "detroit tigers": "DET",
  "houston astros": "HOU",
  "kansas city royals": "KC",
  "los angeles angels": "LAA",
  "los angeles dodgers": "LAD",
  "miami marlins": "MIA",
  "milwaukee brewers": "MIL",
  "minnesota twins": "MIN",
  "new york mets": "NYM",
  "new york yankees": "NYY",
  "philadelphia phillies": "PHI",
  "pittsburgh pirates": "PIT",
  "san diego padres": "SD",
  "san francisco giants": "SF",
  "seattle mariners": "SEA",
  "st. louis cardinals": "STL",
  "st louis cardinals": "STL",
  "tampa bay rays": "TB",
  "texas rangers": "TEX",
  "toronto blue jays": "TOR",
  "washington nationals": "WSH",
};

type OddsEvent = {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: Array<{
    key: string;
    markets?: Array<{
      key: string;
      outcomes?: Array<{
        name: string;
        description?: string;
        price: number;
        point?: number;
      }>;
    }>;
  }>;
};

const mem = new Map<string, { exp: number; val: Map<string, PlayerOdds> }>();
let lastRemaining: number | null = null;

export function oddsRemaining(): number | null {
  return lastRemaining;
}

export function impliedFromAmerican(odds: number): number {
  if (!Number.isFinite(odds)) return 0;
  if (odds >= 0) return 100 / (odds + 100);
  const a = Math.abs(odds);
  return a / (a + 100);
}

/** Round a rate to "in 10" so you don't compare +450 to 18%. */
export function inTens(p: number): number {
  if (!Number.isFinite(p) || p <= 0) return 0;
  return Math.max(1, Math.min(9, Math.round(p * 10)));
}

/**
 * What the book has actually done for this shape — not the shrunk P(HR).
 * 20×20 / mix 4+ ≈ 22%. Cut + mix 2+ ticket ≈ 18%.
 */
export function guysLikeThis(p: PlayerPrediction): number {
  if (p.paSim) return p.paSim.pLow;
  const d = p.signal?.decision;
  if (d?.both20 || (d?.mixHr ?? 0) >= 4) return 0.22;
  if (p.ticket === "play") return 0.18;
  return p.odds?.pBet ?? p.pHr;
}

export type PriceCall = "pay" | "pass" | "fair" | "wait" | "sit";

export type PriceTalk = {
  call: PriceCall;
  title: string;
  why: string;
  american: number | null;
  book: string | null;
};

export function bestPrice(p: PlayerPrediction): BookLine | null {
  const lines = p.odds?.lines.filter((l) => Number.isFinite(l.american)) ?? [];
  if (lines.length === 0) return null;
  return [...lines].sort((a, b) => b.american - a.american)[0];
}

export function takeLine(p: PlayerPrediction): BookLine | null {
  const retail = p.odds?.lines.filter((l) => TAKE.has(l.id) && Number.isFinite(l.american)) ?? [];
  if (retail.length === 0) return bestPrice(p);
  return [...retail].sort((a, b) => b.american - a.american)[0];
}

/** Sharp two-way if posted. Else SGO fairOdds. Else retail de-vig. Never a fake sharp. */
export function marketFair(p: PlayerPrediction): number {
  const sharpFairs = (p.odds?.lines ?? [])
    .filter((l) => SHARP.has(l.id) && l.fair != null && l.fair > 0)
    .map((l) => l.fair as number);
  if (sharpFairs.length > 0) return sharpFairs.reduce((s, n) => s + n, 0) / sharpFairs.length;
  if (p.odds?.fair != null && p.odds.fair > 0) return p.odds.fair;
  const fairs = (p.odds?.lines ?? [])
    .map((l) => l.fair)
    .filter((x): x is number => x != null && x > 0);
  if (fairs.length > 0) return fairs.reduce((s, n) => s + n, 0) / fairs.length;
  return guysLikeThis(p);
}

export function priceTalk(p: PlayerPrediction, grade?: "best" | "yes" | "no"): PriceTalk {
  if (grade === "no" || (p.battingOrder > 5 && grade !== "best")) {
    return { call: "sit", title: "DON'T BET", why: "Not the guy. Don't look at the number.", american: null, book: null };
  }
  const take = takeLine(p);
  if (!take) {
    return { call: "wait", title: "WAIT ON A NUMBER", why: "No FanDuel / DraftKings / Caesars / bet365 line yet.", american: null, book: null };
  }
  const us = marketFair(p);
  const them = impliedFromAmerican(take.american);
  const usN = inTens(us);
  const themN = inTens(them);
  const edge = us - them;
  const n = take.american > 0 ? `+${Math.round(take.american)}` : String(Math.round(take.american));
  const who = take.book;
  const hasDevig = (p.odds?.lines ?? []).some((l) => l.fair != null);
  const market = hasDevig
    ? `De-vig market is ${usN} in 10.`
    : `Guys like this go ${usN} in 10. No two-way to de-vig.`;
  if (edge >= 0.04) {
    return {
      call: "pay",
      title: "PAY THIS NUMBER",
      why: `${market} ${who} pays ${n} — that's ${themN} in 10. They're giving extra. Take it.`,
      american: take.american,
      book: who,
    };
  }
  if (edge <= -0.03) {
    return {
      call: "pass",
      title: "PASS THIS NUMBER",
      why: `${market} ${who} is ${n} — that's ${themN} in 10. Shorter than the market. Don't.`,
      american: take.american,
      book: who,
    };
  }
  return {
    call: "fair",
    title: "FAIR — NO EDGE",
    why: `${market} ${who} ${n} is the same. No extra juice.`,
    american: take.american,
    book: who,
  };
}

export function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function abbrOf(team: string): string | null {
  return TEAM_ABBR[normName(team)] ?? null;
}

function oddsKey(): string | null {
  const k = process.env.ODDS_API_KEY?.trim() || process.env.THE_ODDS_API_KEY?.trim();
  return k || null;
}

export function americanToDecimal(odds: number): number {
  if (odds >= 0) return 1 + odds / 100;
  return 1 + 100 / Math.abs(odds);
}

export function evAtPrice(p: number, american: number): number {
  return p * americanToDecimal(american) - 1;
}

export function deVigOver(over: number, under: number): number {
  const o = impliedFromAmerican(over);
  const u = impliedFromAmerican(under);
  const t = o + u;
  if (t <= 0) return o;
  return o / t;
}

export function pickHrLine(
  outcomes: NonNullable<NonNullable<OddsEvent["bookmakers"]>[0]["markets"]>[0]["outcomes"],
): { american: number; point: number; under: number | null } | null {
  const over = pickAnytime(outcomes);
  if (!over) return null;
  let under: number | null = null;
  for (const o of outcomes ?? []) {
    if ((o.name ?? "").toLowerCase() !== "under") continue;
    if (o.point != null && Math.abs(o.point - over.point) > 0.05) continue;
    if (Number.isFinite(o.price)) under = o.price;
  }
  return { ...over, under };
}

export function powerJuice(p: PlayerPrediction): boolean {
  const pa = p.season?.pa ?? 0;
  const hr = p.season?.hr ?? 0;
  const rate = pa >= 50 ? hr / pa : 0;
  const brl = p.statcast?.barrel ?? p.statcast?.barrelPa ?? 0;
  const xiso = p.statcast?.xIso ?? 0;
  const weekHr = p.week?.nHr ?? 0;
  return hr >= 10 || rate >= 0.03 || brl >= 8 || xiso >= 0.17 || weekHr >= 3;
}

function longshotOk(p: PlayerPrediction, american: number): boolean {
  if (!powerJuice(p)) return false;
  if (american < 1200) return true;
  const pa = p.season?.pa ?? 0;
  const rate = pa >= 50 ? (p.season.hr ?? 0) / pa : 0;
  return (p.season?.hr ?? 0) >= 14 || rate >= 0.035 || (p.statcast?.barrel ?? 0) >= 10;
}

/** Game 1+ HR for pricing: shrunk HR/G, not 1-(1-p)^PA vs a 7.7% prior. */
export function gameHrProb(p: PlayerPrediction): number {
  const seasonPa = p.season?.pa ?? 0;
  const hr = p.season?.hr ?? 0;
  const games = Math.max(20, seasonPa / 4.15);
  const hrG = shrinkRate(hr, games, 0.077, 80);
  const seasonRate = seasonPa >= 40 ? hr / seasonPa : 0.031;
  const tilt = seasonRate > 0.004 ? clamp(p.pHrPa / seasonRate, 0.65, 1.7) : 1;
  return clamp(hrG * Math.pow(tilt, 0.42), 0.03, 0.135);
}

export function researchLive(p: PlayerPrediction): boolean {
  const d = p.signal?.decision;
  if (!d) return false;
  if (d.both20) return true;
  if (d.mixHr >= 2) return true;
  return false;
}

export function bookPlay(p: PlayerPrediction): boolean {
  if (p.lineupSource === "projected") return false;
  if (p.confidenceBand === "thin") return false;
  if (p.battingOrder > 5) return false;
  if (!p.pitcher) return false;
  if (juiceCall(p).call === "no") return false;
  const d = p.signal.decision;
  if (d.both20) return true;
  if (d.pass && d.mixHr >= 2) return true;
  return false;
}

export function scoreEv(players: PlayerPrediction[]): void {
  const mean = (xs: number[]) => xs.reduce((s, n) => s + n, 0) / xs.length;
  for (const p of players) {
    const odds = p.odds;
    if (!odds?.lines.length) continue;
    const sgoFair = odds.fair != null && odds.fair > 0 ? odds.fair : null;
    for (const line of odds.lines) {
      line.implied = impliedFromAmerican(line.american);
      if (line.under != null) line.fair = deVigOver(line.american, line.under);
    }
    const sharpFairs = odds.lines
      .filter((l) => SHARP.has(l.id) && l.fair != null && l.fair > 0)
      .map((l) => l.fair as number);
    const allFairs = odds.lines.map((l) => l.fair).filter((x): x is number => x != null && x > 0);
    odds.fair = sharpFairs.length ? mean(sharpFairs) : allFairs.length ? mean(allFairs) : sgoFair;
    const implieds = odds.lines.map((l) => l.implied);
    odds.consensus = implieds.length ? mean(implieds) : null;
    odds.pBet = gameHrProb(p);
    const take = takeLine(p);
    const fairP = odds.fair;
    for (const line of odds.lines) {
      const pUse = line.fair ?? fairP;
      line.ev = pUse != null && longshotOk(p, line.american) ? evAtPrice(pUse, line.american) : null;
    }
    odds.ev =
      take && fairP != null && longshotOk(p, take.american) ? evAtPrice(fairP, take.american) : null;
    odds.bestId = take?.id ?? null;
    odds.edge = take && fairP != null ? fairP - take.implied : null;
    const fd = odds.lines.find((l) => l.id === "fd");
    const dk = odds.lines.find((l) => l.id === "dk");
    const t = ticketOf(p, !!(fd && dk));
    odds.ticket = t.grade;
    odds.why = t.why;
  }
}

export function playWhy(p: PlayerPrediction): string {
  const d = p.signal.decision;
  if (d.both20) return "20×20 · book 20% on 17 nights";
  if (d.pass && d.mixHr >= 2) return `Cut + ${d.mixHr} mix HR · 17% in the book`;
  return "Book play";
}

export function markTickets(players: PlayerPrediction[]): void {
  for (const p of players) {
    const t = ticketOf(p);
    p.ticket = t.grade;
    p.ticketWhy = t.why;
    if (p.odds) {
      p.odds.ticket = t.grade;
      p.odds.why = t.why;
    }
  }
}

export function ticketOf(
  p: PlayerPrediction,
  twoBooks?: boolean,
): { grade: "play" | "lean" | null; why: string | null } {
  if (bookPlay(p)) return { grade: "play", why: playWhy(p) };
  const o = p.odds;
  const fd = o?.lines.find((l) => l.id === "fd" && l.ev != null);
  const dk = o?.lines.find((l) => l.id === "dk" && l.ev != null);
  const two = twoBooks ?? !!(fd && dk);
  if (two && powerJuice(p) && (o?.ev ?? -1) >= 0.08) {
    return { grade: "lean", why: "Price only — not a book play" };
  }
  return { grade: null, why: null };
}

export function pickAnytime(
  outcomes: NonNullable<NonNullable<OddsEvent["bookmakers"]>[0]["markets"]>[0]["outcomes"],
): { american: number; point: number } | null {
  const hits: Array<{ american: number; point: number }> = [];
  for (const o of outcomes ?? []) {
    const n = (o.name ?? "").toLowerCase();
    const yes = n === "over" || n === "yes";
    if (!yes) continue;
    if (!Number.isFinite(o.price)) continue;
    const point = o.point == null ? (n === "yes" ? 0.5 : 0.5) : o.point;
    // 1+ HR: O 0.5, O 1.0 milestone, or Yes. 1.5 is 2+ — skip for anytime.
    if (point > 1) continue;
    hits.push({ american: o.price, point });
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.point - b.point);
  return hits[0];
}

export function attachLines(
  players: PlayerPrediction[],
  byPlayer: Map<string, PlayerOdds>,
): void {
  for (const p of players) {
    const n = normName(p.name);
    const last = normName(p.lastName) || n.split(" ").at(-1) || n;
    const short = n.includes(" ") ? `${n[0]} ${last}` : n;
    let hit: PlayerOdds | null = null;
    for (const team of teamsOf(p.teamAbbr)) {
      hit =
        byPlayer.get(`${team}:${n}`) ??
        byPlayer.get(`${team}:${short}`) ??
        byPlayer.get(`${team}:${last}`) ??
        null;
      if (hit) break;
    }
    p.odds = hit;
  }
}

export async function fetchHrOdds(
  date: string,
  apiKey?: string | null,
  onlyTeams?: Set<string>,
): Promise<Map<string, PlayerOdds>> {
  const empty = new Map<string, PlayerOdds>();
  const key = (apiKey?.trim() || oddsKey()) ?? null;
  if (!key) return empty;
  const cacheId = `us2:${date}:${onlyTeams ? [...onlyTeams].sort().join(",") : "all"}`;
  pruneMap(mem, 24);
  const hit = mem.get(cacheId);
  if (hit && hit.exp > Date.now()) return hit.val;
  try {
    const events = await getJson<OddsEvent[]>(
      `${API}/sports/baseball_mlb/events?dateFormat=iso&apiKey=${encodeURIComponent(key)}`,
    );
    const todays = events.filter((e) => {
      if (eventDateET(e.commence_time) !== date) return false;
      if (!onlyTeams || onlyTeams.size === 0) return true;
      const home = abbrOf(e.home_team);
      const away = abbrOf(e.away_team);
      return (home && onlyTeams.has(home)) || (away && onlyTeams.has(away));
    });
    const maps = await mapPool(todays, 3, (ev) => fetchEvent(ev, key));
    const out = new Map<string, PlayerOdds>();
    for (const m of maps) {
      for (const [k, v] of m) out.set(k, v);
    }
    mem.set(cacheId, { exp: Date.now() + 2 * 60 * 60_000, val: out });
    return out;
  } catch {
    return empty;
  }
}

async function fetchEvent(ev: OddsEvent, key: string): Promise<Map<string, PlayerOdds>> {
  const out = new Map<string, PlayerOdds>();
  const home = abbrOf(ev.home_team);
  const away = abbrOf(ev.away_team);
  if (!home || !away) return out;
  const pull = (regions: string) => {
    const url =
      `${API}/sports/baseball_mlb/events/${ev.id}/odds` +
      `?regions=${regions}&oddsFormat=american&dateFormat=iso` +
      `&bookmakers=${BOOK_KEYS}&markets=${MARKETS}` +
      `&apiKey=${encodeURIComponent(key)}`;
    return getJson<OddsEvent>(url);
  };
  let data: OddsEvent;
  try {
    data = await pull("us");
  } catch {
    return out;
  }
  const byName = new Map<string, BookLine[]>();
  for (const bk of data.bookmakers ?? []) {
    const meta = BOOKS.find((b) => b.api === bk.key);
    if (!meta) continue;
    for (const mk of bk.markets ?? []) {
      if (mk.key !== "batter_home_runs" && mk.key !== "batter_home_runs_alternate") continue;
      const grouped = new Map<string, NonNullable<typeof mk.outcomes>>();
      for (const o of mk.outcomes ?? []) {
        const raw = o.description || (isPlayerLabel(o.name) ? o.name : "");
        const who = normName(raw);
        if (!who) continue;
        const arr = grouped.get(who) ?? [];
        arr.push(o);
        grouped.set(who, arr);
      }
      for (const [who, rows] of grouped) {
        const picked = pickHrLine(rows);
        if (!picked) continue;
        const line: BookLine = {
          id: meta.id,
          book: meta.book,
          american: picked.american,
          implied: impliedFromAmerican(picked.american),
          point: picked.point,
          under: picked.under,
          fair: picked.under != null ? deVigOver(picked.american, picked.under) : null,
          ev: null,
        };
        const arr = byName.get(who) ?? [];
        const existing = arr.find((x) => x.id === line.id);
        if (!existing) arr.push(line);
        else if (line.point < existing.point) Object.assign(existing, line);
        byName.set(who, arr);
      }
    }
  }
  for (const [who, lines] of byName) {
    lines.sort((a, b) => orderId(a.id) - orderId(b.id));
    const consensus =
      lines.length > 0 ? lines.reduce((s, l) => s + l.implied, 0) / lines.length : null;
    const pack: PlayerOdds = {
      lines,
      consensus: null,
      fair: null,
      pBet: null,
      ev: null,
      edge: null,
      bestId: null,
      ticket: null,
      why: null,
    };
    const last = who.split(" ").at(-1) ?? who;
    const short = who.includes(" ") ? `${who[0]} ${last}` : who;
    for (const team of [...teamsOf(home), ...teamsOf(away)]) {
      out.set(`${team}:${who}`, pack);
      out.set(`${team}:${short}`, pack);
      if (!out.has(`${team}:${last}`)) out.set(`${team}:${last}`, pack);
    }
  }
  return out;
}

function isPlayerLabel(name: string | undefined): boolean {
  const n = (name ?? "").toLowerCase();
  if (!n || n === "over" || n === "under" || n === "yes" || n === "no") return false;
  return /[a-z]/.test(n);
}

function orderId(id: BookId): number {
  return id === "fd" ? 0 : id === "dk" ? 1 : id === "mg" ? 2 : id === "cz" ? 3 : id === "pn" ? 4 : id === "cr" ? 5 : 6;
}

export function eventDateET(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetchOk(url, { headers: { Accept: "application/json" } }, 12_000);
  const left = res.headers.get("x-requests-remaining");
  if (left != null && Number.isFinite(Number(left))) lastRemaining = Number(left);
  if (!res.ok) throw new Error(`http ${res.status}`);
  return (await res.json()) as T;
}

async function mapPool<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += n) {
    const chunk = await Promise.all(xs.slice(i, i + n).map(fn));
    out.push(...chunk);
  }
  return out;
}
