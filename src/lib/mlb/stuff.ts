import { fetchOk } from "./http.ts";
import { pitchLabel } from "./savant.ts";
import { shiftISODate } from "./format.ts";

export type StuffPitch = {
  code: string;
  name: string;
  n: number;
  nBase: number;
  velo: number | null;
  veloBase: number | null;
  veloDelta: number | null;
  spin: number | null;
  spinBase: number | null;
  spinDelta: number | null;
  down: boolean;
};

export type StuffCheck = {
  live: boolean;
  down: boolean;
  line: string;
  pitches: StuffPitch[];
};

type Acc = { n: number; velo: number; spin: number; spinN: number };

function emptyAcc(): Acc {
  return { n: 0, velo: 0, spin: 0, spinN: 0 };
}

function mean(sum: number, n: number): number | null {
  return n > 0 ? sum / n : null;
}

export function buildStuff(
  recent: Map<string, Acc>,
  base: Map<string, Acc>,
  live = false,
): StuffCheck {
  const codes = new Set([...recent.keys(), ...base.keys()]);
  const pitches: StuffPitch[] = [];
  for (const code of codes) {
    const r = recent.get(code);
    const b = base.get(code);
    if (!r || r.n < 6) continue;
    const velo = mean(r.velo, r.n);
    const veloBase = b ? mean(b.velo, b.n) : null;
    const spin = mean(r.spin, r.spinN);
    const spinBase = b ? mean(b.spin, b.spinN) : null;
    const veloDelta = velo != null && veloBase != null ? velo - veloBase : null;
    const spinDelta = spin != null && spinBase != null ? spin - spinBase : null;
    const down =
      (veloDelta != null && veloDelta <= -1.2 && r.n >= 8) ||
      (spinDelta != null && spinDelta <= -120 && r.spinN >= 8);
    pitches.push({
      code,
      name: pitchLabel(code),
      n: r.n,
      nBase: b?.n ?? 0,
      velo,
      veloBase,
      veloDelta,
      spin,
      spinBase,
      spinDelta,
      down,
    });
  }
  pitches.sort((a, b) => b.n - a.n);
  const loud = pitches.filter((p) => p.down).slice(0, 2);
  const down = loud.length > 0;
  const bits = loud.map((p) => {
    if (p.veloDelta != null && p.veloDelta <= -1.2) {
      return `${p.name} ${p.veloDelta.toFixed(1)} mph`;
    }
    return `${p.name} spin ${Math.round(p.spinDelta ?? 0)}`;
  });
  return {
    live,
    down,
    line: down
      ? `${live ? "Tonight" : "Lately"} ${bits.join(" · ")}. Hunt it.`
      : live
        ? "Stuff is holding tonight."
        : "Stuff looks like himself.",
    pitches: pitches.slice(0, 5),
  };
}

export async function fetchStuffMap(ids: number[], asOf: string, season: number): Promise<Map<number, StuffCheck>> {
  const unique = [...new Set(ids.filter((id) => id > 0))];
  const out = new Map<number, StuffCheck>();
  if (unique.length === 0) return out;
  const from = shiftISODate(asOf, -28);
  const mid = shiftISODate(asOf, -5);
  const POOL = 4;
  for (let i = 0; i < unique.length; i += POOL) {
    const batch = unique.slice(i, i + POOL);
    const parts = await Promise.all(batch.map((id) => fetchOneStuff(id, from, mid, asOf, season)));
    for (let j = 0; j < batch.length; j++) {
      if (parts[j]) out.set(batch[j], parts[j]!);
    }
  }
  return out;
}

async function fetchOneStuff(
  id: number,
  from: string,
  mid: string,
  to: string,
  season: number,
): Promise<StuffCheck | null> {
  const url =
    `https://baseballsavant.mlb.com/statcast_search/csv?all=true` +
    `&hfSea=${season}%7C&hfGT=R%7C&player_type=pitcher&pitchers_lookup%5B%5D=${id}` +
    `&game_date_gt=${from}&game_date_lt=${to}` +
    `&min_pitches=0&min_results=0&type=details`;
  try {
    const res = await fetchOk(url, { headers: { "User-Agent": "Mozilla/5.0 Moonshot" } }, 14_000);
    if (!res.ok) return null;
    const text = await res.text();
    return parseStuffCsv(text, mid);
  } catch {
    return null;
  }
}

export function parseStuffCsv(text: string, mid: string): StuffCheck | null {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length < 3) return null;
  const header = splitCsv(lines[0]).map((h) => h.replace(/^"|"$/g, ""));
  const iType = header.indexOf("pitch_type");
  const iVelo = header.indexOf("release_speed");
  const iSpin = header.indexOf("release_spin_rate");
  const iDate = header.indexOf("game_date");
  if (iType < 0 || iVelo < 0 || iDate < 0) return null;
  const recent = new Map<string, Acc>();
  const base = new Map<string, Acc>();
  const bump = (store: Map<string, Acc>, code: string, velo: number, spin: number) => {
    let a = store.get(code);
    if (!a) {
      a = emptyAcc();
      store.set(code, a);
    }
    a.n += 1;
    a.velo += velo;
    if (Number.isFinite(spin) && spin > 0) {
      a.spin += spin;
      a.spinN += 1;
    }
  };
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cols = splitCsv(lines[i]);
    const code = (cols[iType] ?? "").toUpperCase();
    const velo = Number(cols[iVelo]);
    const date = (cols[iDate] ?? "").slice(0, 10);
    if (!code || code === "null" || !Number.isFinite(velo) || velo < 50 || !date) continue;
    const spin = iSpin >= 0 ? Number(cols[iSpin]) : NaN;
    bump(date >= mid ? recent : base, code, velo, spin);
  }
  const check = buildStuff(recent, base, false);
  return check.pitches.length ? check : null;
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export async function overlayLiveStuff(
  gamePk: number,
  pitcherId: number,
  prior: StuffCheck | null,
): Promise<StuffCheck | null> {
  try {
    const res = await fetchOk(
      `https://statsapi.mlb.com/api/v1/game/${gamePk}/playByPlay`,
      { headers: { Accept: "application/json" } },
      10_000,
    );
    if (!res.ok) return prior;
    const data = (await res.json()) as {
      allPlays?: Array<{
        matchup?: { pitcher?: { id?: number } };
        playEvents?: Array<{
          isPitch?: boolean;
          details?: { type?: { code?: string } };
          pitchData?: { startSpeed?: number; breaks?: { spinRate?: number } };
        }>;
      }>;
    };
    const recent = new Map<string, Acc>();
    for (const play of data.allPlays ?? []) {
      if (play.matchup?.pitcher?.id !== pitcherId) continue;
      for (const ev of play.playEvents ?? []) {
        if (!ev.isPitch) continue;
        const code = (ev.details?.type?.code ?? "").toUpperCase();
        const velo = ev.pitchData?.startSpeed;
        if (!code || velo == null || velo < 50) continue;
        let a = recent.get(code);
        if (!a) {
          a = emptyAcc();
          recent.set(code, a);
        }
        a.n += 1;
        a.velo += velo;
        const spin = ev.pitchData?.breaks?.spinRate;
        if (spin && spin > 0) {
          a.spin += spin;
          a.spinN += 1;
        }
      }
    }
    const n = [...recent.values()].reduce((s, a) => s + a.n, 0);
    if (n < 8) return prior;
    const base = new Map<string, Acc>();
    for (const p of prior?.pitches ?? []) {
      if (p.veloBase == null || p.nBase < 8) continue;
      base.set(p.code, {
        n: p.nBase,
        velo: p.veloBase * p.nBase,
        spin: (p.spinBase ?? 0) * Math.max(p.nBase, 1),
        spinN: p.spinBase != null ? p.nBase : 0,
      });
    }
    return buildStuff(recent, base, true);
  } catch {
    return prior;
  }
}
