import { etDayBoundsIso } from "./format.ts";
import { asArray, asRecord, fetchOk, pruneMap } from "./http.ts";
import { abbrOf, deVigOver, eventDateET, impliedFromAmerican, normName } from "./odds.ts";
import type { BookId, BookLine, PlayerOdds } from "./types.ts";

const API = "https://api.sportsgameodds.com/v2/events";
const HR_ODDS = [
  "batting_homeRuns-PLAYER_ID-game-yn-yes",
  "batting_homeRuns-PLAYER_ID-game-ou-over",
].join(",");
/** Take: FD / DK / Caesars / bet365. Sharp: Pin / Circa / Bookmaker / BO / LowVig. */
const BOOKS = [
  { api: "fanduel", id: "fd" as const, book: "FanDuel" },
  { api: "draftkings", id: "dk" as const, book: "DraftKings" },
  { api: "caesars", id: "cz" as const, book: "Caesars" },
  { api: "bet365", id: "b3" as const, book: "bet365" },
  { api: "pinnacle", id: "pn" as const, book: "Pinnacle" },
  { api: "circa", id: "cr" as const, book: "Circa" },
  { api: "bookmakereu", id: "be" as const, book: "Bookmaker.eu" },
  { api: "betonline", id: "bo" as const, book: "BetOnline" },
  { api: "lowvig", id: "lv" as const, book: "LowVig" },
] as const;
const ALIAS: Record<string, (typeof BOOKS)[number]["api"]> = {
  fanduel: "fanduel",
  draftkings: "draftkings",
  caesars: "caesars",
  williamhill: "caesars",
  bet365: "bet365",
  bet365us: "bet365",
  pinnacle: "pinnacle",
  pinnaclesports: "pinnacle",
  circa: "circa",
  circasports: "circa",
  bookmakereu: "bookmakereu",
  bookmaker: "bookmakereu",
  bookmakereusports: "bookmakereu",
  betonline: "betonline",
  betonlinesports: "betonline",
  lowvig: "lowvig",
  lowvigag: "lowvig",
};
const BY_API = new Map(BOOKS.map((b) => [b.api, b]));

function metaOf(apiKey: string) {
  const stem = apiKey.toLowerCase().replace(/[^a-z0-9]/g, "");
  const api = ALIAS[stem];
  return api ? BY_API.get(api) : undefined;
}
const mem = new Map<string, { exp: number; val: Map<string, PlayerOdds> }>();

type SgoBook = { odds?: string; available?: boolean; overUnder?: string | number };
type SgoOdd = {
  oddID?: string;
  opposingOddID?: string;
  statID?: string;
  statEntityID?: string;
  periodID?: string;
  betTypeID?: string;
  sideID?: string;
  fairOdds?: string;
  overUnder?: string | number;
  byBookmaker?: Record<string, SgoBook>;
};
type SgoPlayer = { name?: string; firstName?: string; lastName?: string; teamID?: string };
type SgoTeam = {
  teamID?: string;
  names?: { short?: string; medium?: string; long?: string };
  abbreviations?: { standard?: string };
};
type SgoEvent = {
  eventID?: string;
  status?: { startsAt?: string };
  teams?: { home?: SgoTeam; away?: SgoTeam };
  players?: Record<string, SgoPlayer>;
  odds?: Record<string, SgoOdd>;
};

function americanOf(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(/^\+/, ""));
  return Number.isFinite(n) ? n : null;
}

function teamAbbr(team: SgoTeam | undefined): string | null {
  if (!team) return null;
  const short = team.abbreviations?.standard || team.names?.short || team.names?.medium || team.names?.long;
  if (!short) return null;
  if (/^[A-Z]{2,3}$/.test(short)) return short === "ARI" ? "AZ" : short === "CHW" ? "CWS" : short === "WAS" ? "WSH" : short;
  return abbrOf(short);
}

function playerName(p: SgoPlayer | undefined, id: string): string {
  if (p?.name) return p.name;
  if (p?.firstName || p?.lastName) return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
  return id.replace(/_\d+_MLB$/i, "").replace(/_/g, " ");
}

function ouPoint(odd: SgoOdd, book?: SgoBook): number {
  const raw = book?.overUnder ?? odd.overUnder;
  const n = raw == null ? 0.5 : Number(raw);
  return Number.isFinite(n) ? n : 0.5;
}

export function parseSgoEvents(events: unknown, date: string): Map<string, PlayerOdds> {
  const out = new Map<string, PlayerOdds>();
  const rows = asArray(events) ?? [];
  for (const raw of rows) {
    const ev = asRecord(raw) as SgoEvent | null;
    if (!ev) continue;
    const start = ev.status?.startsAt;
    if (start && eventDateET(start) !== date) continue;
    const home = teamAbbr(ev.teams?.home);
    const away = teamAbbr(ev.teams?.away);
    if (!home || !away) continue;
    const players = ev.players ?? {};
    const odds = ev.odds ?? {};
    const byPlayer = new Map<string, { yes?: SgoOdd; over?: SgoOdd; no?: SgoOdd; under?: SgoOdd }>();
    for (const odd of Object.values(odds)) {
      if (odd.statID !== "batting_homeRuns" && odd.statID !== "batting_home_runs" && odd.statID !== "hr") continue;
      if (odd.periodID !== "game") continue;
      const pid = odd.statEntityID ?? "";
      if (!pid) continue;
      const slot = byPlayer.get(pid) ?? {};
      if (odd.betTypeID === "yn" && odd.sideID === "yes") slot.yes = odd;
      else if (odd.betTypeID === "yn" && odd.sideID === "no") slot.no = odd;
      else if (odd.betTypeID === "ou" && odd.sideID === "over") slot.over = odd;
      else if (odd.betTypeID === "ou" && odd.sideID === "under") slot.under = odd;
      byPlayer.set(pid, slot);
    }
    for (const [pid, slot] of byPlayer) {
      const main = slot.yes ?? (slot.over && ouPoint(slot.over) <= 1 ? slot.over : null);
      if (!main) continue;
      const opp = main.betTypeID === "yn" ? slot.no : slot.under;
      const lines: BookLine[] = [];
      const seen = new Set<string>();
      for (const [apiKey, bk] of Object.entries(main.byBookmaker ?? {})) {
        const meta = metaOf(apiKey);
        if (!meta || seen.has(meta.id)) continue;
        if (!bk || bk.available === false) continue;
        const american = americanOf(bk.odds);
        if (american == null) continue;
        const point = main.betTypeID === "ou" ? ouPoint(main, bk) : 0.5;
        if (point > 1) continue;
        const oppBk = opp?.byBookmaker?.[apiKey] ?? opp?.byBookmaker?.[meta.api];
        const under = oppBk ? americanOf(oppBk.odds) : null;
        seen.add(meta.id);
        lines.push({
          id: meta.id,
          book: meta.book,
          american,
          implied: impliedFromAmerican(american),
          point,
          under,
          fair: under != null ? deVigOver(american, under) : null,
          ev: null,
        });
      }
      if (!lines.length) continue;
      const fairAm = americanOf(main.fairOdds);
      const pack: PlayerOdds = {
        lines,
        consensus: lines.reduce((s, l) => s + l.implied, 0) / lines.length,
        fair: fairAm != null ? impliedFromAmerican(fairAm) : lines.find((l) => l.fair != null)?.fair ?? null,
        pBet: null,
        ev: null,
        edge: null,
        bestId: null,
        ticket: null,
        why: null,
      };
      const who = normName(playerName(players[pid], pid));
      const last = who.split(" ").at(-1) ?? who;
      const short = who.includes(" ") ? `${who[0]} ${last}` : who;
      for (const team of [home, away]) {
        out.set(`${team}:${who}`, pack);
        out.set(`${team}:${short}`, pack);
        if (!out.has(`${team}:${last}`)) out.set(`${team}:${last}`, pack);
      }
    }
  }
  return out;
}

export async function fetchSgoHrOdds(date: string, apiKey: string): Promise<Map<string, PlayerOdds>> {
  const empty = new Map<string, PlayerOdds>();
  const key = apiKey.trim();
  if (key.length < 8) return empty;
  const cacheId = `sgo6:${date}`;
  pruneMap(mem, 24);
  const hit = mem.get(cacheId);
  if (hit && hit.exp > Date.now()) return hit.val;
  const { after, before } = etDayBoundsIso(date);
  const events: unknown[] = [];
  let cursor: string | null = null;
  try {
    for (let page = 0; page < 8; page++) {
      const qs = new URLSearchParams({
        apiKey: key,
        sportID: "BASEBALL",
        leagueID: "MLB",
        oddsAvailable: "true",
        startsAfter: after,
        startsBefore: before,
        oddID: HR_ODDS,
        includeOpposingOdds: "true",
        includeAltLines: "true",
        limit: "15",
      });
      if (cursor) qs.set("cursor", cursor);
      const url = `${API}?${qs.toString()}`;
      const res = await fetchOk(url, { headers: { Accept: "application/json", "x-api-key": key } }, 18_000);
      if (!res.ok) break;
      const json: unknown = await res.json();
      const rec = asRecord(json);
      const batch = asArray(rec?.data) ?? [];
      events.push(...batch);
      const next = rec?.nextCursor;
      cursor = typeof next === "string" && next.length > 0 ? next : null;
      if (!cursor || batch.length === 0) break;
    }
  } catch {
    return empty;
  }
  const out = parseSgoEvents(events, date);
  if (out.size > 0) mem.set(cacheId, { exp: Date.now() + 2 * 60 * 60_000, val: out });
  return out;
}
