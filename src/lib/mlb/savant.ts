export type SavantBatter = {
  id: number;
  pa: number;
  barrel: number | null;
  hardHit: number | null;
  ev: number | null;
  launch: number | null;
  xIso: number | null;
  xSlg: number | null;
  pull: number | null;
  flyBall: number | null;
  sweetSpot: number | null;
  swingSpeed: number | null;
  attackAngle: number | null;
  solid: number | null;
  kPct: number | null;
  whiff: number | null;
  blast: number | null;
  squaredUp: number | null;
};

export type SavantPitcher = {
  id: number;
  pa: number;
  barrel: number | null;
  hardHit: number | null;
  ev: number | null;
  xIso: number | null;
  flyBall: number | null;
  groundBall: number | null;
  inZone: number | null;
  edge: number | null;
  kPct: number | null;
  whiff: number | null;
};

export type SavantLeague = {
  barrel: number;
  ev: number;
  xIso: number;
  pull: number;
  flyBall: number;
  hardHit: number;
  swingSpeed: number;
  solid: number;
  inZone: number;
  edge: number;
  kPct: number;
  whiff: number;
  sweetSpot: number;
  blast: number;
};

export type SavantBundle = {
  batters: Map<number, SavantBatter>;
  pitchers: Map<number, SavantPitcher>;
  league: SavantLeague;
};

export type SideContact = {
  bbe: number;
  barrels: number;
};

export type GameEv = {
  date: string;
  maxEv: number;
  n100: number;
  nTanks: number;
  bbe: number;
  launchSum: number;
  nLaunch2030: number;
};

export type WeekContact = {
  bbe: number;
  barrels: number;
  solid: number;
  weak: number;
  evSum: number;
  batSpeedSum: number;
  batSpeedN: number;
  pullN: number;
  pull: number;
  pullAir: number;
  aaN: number;
  idealAa: number;
  launchN: number;
  launchSum: number;
  vsL: SideContact;
  vsR: SideContact;
  vsHard: SideContact;
  vsBreak: SideContact;
  vsOff: SideContact;
  byPitch: Record<string, SideContact>;
  heart: SideContact;
  chase: SideContact;
  games: GameEv[];
  tanks: number;
};

export function barrelPct(side: SideContact | WeekContact): number | null {
  if (side.bbe < 1) return null;
  return (100 * side.barrels) / side.bbe;
}

export function isTank(ev: number, launch: number, pulled: boolean): boolean {
  return ev >= 102 && launch >= 20 && launch <= 38 && pulled;
}

export function tankFlags(week: WeekContact | null | undefined): {
  count: number;
  last1: boolean;
  last3: number;
} {
  const games = week?.games ?? [];
  const last3 = games.slice(0, 3).reduce((s, g) => s + g.nTanks, 0);
  return {
    count: week?.tanks ?? 0,
    last1: (games[0]?.nTanks ?? 0) > 0,
    last3,
  };
}

export function ev100Flags(week: WeekContact | null | undefined): {
  last1: boolean;
  last3: boolean;
  n100Last3: number;
  maxEvLast1: number | null;
  hot100Last3: boolean;
} {
  const games = week?.games ?? [];
  if (games.length === 0) {
    return { last1: false, last3: false, n100Last3: 0, maxEvLast1: null, hot100Last3: false };
  }
  const last3 = games.slice(0, 3);
  const n100Last3 = last3.reduce((s, g) => s + g.n100, 0);
  return {
    last1: games[0].n100 > 0,
    last3: n100Last3 > 0,
    n100Last3,
    maxEvLast1: games[0].maxEv,
    hot100Last3: n100Last3 >= 4,
  };
}

export function weekShape(week: WeekContact | null | undefined): {
  pullPct: number | null;
  pullAirPct: number | null;
  idealAaPct: number | null;
  launchBandLast3: boolean;
  launchBandLast5: boolean;
  nLaunchBandLast5: number;
} {
  if (!week) {
    return {
      pullPct: null,
      pullAirPct: null,
      idealAaPct: null,
      launchBandLast3: false,
      launchBandLast5: false,
      nLaunchBandLast5: 0,
    };
  }
  const pullPct = week.pullN >= 8 ? (100 * week.pull) / week.pullN : null;
  const pullAirPct = week.pullN >= 8 ? (100 * week.pullAir) / week.pullN : null;
  const idealAaPct = week.aaN >= 8 ? (100 * week.idealAa) / week.aaN : null;
  const usable = week.games.filter((g) => g.bbe >= 2);
  const inBand = (g: GameEv) => {
    const mean = g.launchSum / g.bbe;
    return mean >= 20 && mean <= 30;
  };
  const last3 = usable.slice(0, 3);
  const last5 = usable.slice(0, 5);
  const n5 = last5.filter(inBand).length;
  return {
    pullPct,
    pullAirPct,
    idealAaPct,
    launchBandLast3: last3.length >= 3 && last3.filter(inBand).length >= 3,
    launchBandLast5: last5.length >= 4 && n5 >= 3,
    nLaunchBandLast5: n5,
  };
}

const DEFAULT_LEAGUE: SavantLeague = {
  barrel: 7.1,
  ev: 88.3,
  xIso: 0.155,
  pull: 40,
  flyBall: 25,
  hardHit: 38,
  swingSpeed: 71.8,
  solid: 6.0,
  inZone: 49,
  edge: 38,
  kPct: 22.4,
  whiff: 24.6,
  sweetSpot: 33.2,
  blast: 12.5,
};

const SAVANT_HEADERS = {
  Accept: "text/csv,text/plain,*/*",
  "User-Agent":
    "Mozilla/5.0 (compatible; Moonshot/1.0; +https://baseballsavant.mlb.com)",
};

const BAT_FIELDS = [
  "player_id",
  "pa",
  "barrel_batted_rate",
  "hard_hit_percent",
  "exit_velocity_avg",
  "launch_angle_avg",
  "xiso",
  "xslg",
  "pull_percent",
  "flyballs_percent",
  "sweet_spot_percent",
  "avg_swing_speed",
  "attack_angle",
  "solidcontact_percent",
  "k_percent",
  "whiff_percent",
].join(",");

const PIT_FIELDS = [
  "player_id",
  "pa",
  "barrel_batted_rate",
  "hard_hit_percent",
  "exit_velocity_avg",
  "xiso",
  "groundballs_percent",
  "flyballs_percent",
  "in_zone_percent",
  "edge_percent",
  "k_percent",
  "whiff_percent",
].join(",");

export async function fetchSavant(season: number): Promise<SavantBundle> {
  try {
    const [batTxt, pitTxt] = await Promise.all([
      savantCsv(season, "batter", BAT_FIELDS),
      savantCsv(season, "pitcher", PIT_FIELDS),
    ]);
    const batRows = parseCsv(batTxt);
    const pitRows = parseCsv(pitTxt);
    const batters = new Map<number, SavantBatter>();
    for (const r of batRows) {
      const id = int(r.player_id);
      if (!id) continue;
      batters.set(id, {
        id,
        pa: int(r.pa),
        barrel: num(r.barrel_batted_rate),
        hardHit: num(r.hard_hit_percent),
        ev: num(r.exit_velocity_avg),
        launch: num(r.launch_angle_avg),
        xIso: num(r.xiso),
        xSlg: num(r.xslg),
        pull: num(r.pull_percent),
        flyBall: num(r.flyballs_percent),
        sweetSpot: num(r.sweet_spot_percent),
        swingSpeed: num(r.avg_swing_speed),
        attackAngle: num(r.attack_angle),
        solid: num(r.solidcontact_percent),
        kPct: num(r.k_percent),
        whiff: num(r.whiff_percent),
        blast: null,
        squaredUp: null,
      });
    }
    const blasts = await fetchBatTracking(season);
    for (const [id, b] of blasts) {
      const row = batters.get(id);
      if (!row) continue;
      row.blast = b.blast;
      row.squaredUp = b.squaredUp;
    }
    const pitchers = new Map<number, SavantPitcher>();
    for (const r of pitRows) {
      const id = int(r.player_id);
      if (!id) continue;
      pitchers.set(id, {
        id,
        pa: int(r.pa),
        barrel: num(r.barrel_batted_rate),
        hardHit: num(r.hard_hit_percent),
        ev: num(r.exit_velocity_avg),
        xIso: num(r.xiso),
        flyBall: num(r.flyballs_percent),
        groundBall: num(r.groundballs_percent),
        inZone: num(r.in_zone_percent),
        edge: num(r.edge_percent),
        kPct: num(r.k_percent),
        whiff: num(r.whiff_percent),
      });
    }
    return { batters, pitchers, league: leagueFrom(batters, pitchers) };
  } catch {
    return { batters: new Map(), pitchers: new Map(), league: DEFAULT_LEAGUE };
  }
}

async function fetchBatTracking(
  season: number,
): Promise<Map<number, { blast: number | null; squaredUp: number | null }>> {
  const out = new Map<number, { blast: number | null; squaredUp: number | null }>();
  try {
    const url =
      `https://baseballsavant.mlb.com/leaderboard/bat-tracking?seasonStart=${season}` +
      `&seasonEnd=${season}&type=batter&csv=true`;
    const res = await fetch(url, { headers: SAVANT_HEADERS });
    if (!res.ok) return out;
    const rows = parseCsv(await res.text());
    for (const r of rows) {
      const id = int(r.id) || int(r.player_id);
      if (!id) continue;
      out.set(id, {
        blast: fracToPct(r.blast_per_bat_contact),
        squaredUp: fracToPct(r.squared_up_per_bat_contact),
      });
    }
  } catch {
    /* bat tracking is optional */
  }
  return out;
}

function fracToPct(v: string | undefined): number | null {
  const n = num(v);
  if (n == null) return null;
  return n <= 1.5 ? n * 100 : n;
}

async function savantCsv(season: number, type: "batter" | "pitcher", selections: string): Promise<string> {
  const url =
    `https://baseballsavant.mlb.com/leaderboard/custom?year=${season}` +
    `&type=${type}&min=1&selections=${encodeURIComponent(selections)}&csv=true`;
  const res = await fetch(url, {
    headers: SAVANT_HEADERS,
  });
  if (!res.ok) throw new Error(`Savant ${res.status}`);
  return res.text();
}

function leagueFrom(
  batters: Map<number, SavantBatter>,
  pitchers: Map<number, SavantPitcher>,
): SavantLeague {
  const rows = [...batters.values()].filter((b) => b.pa >= 60);
  if (rows.length < 40) return DEFAULT_LEAGUE;
  const avg = (pick: (b: SavantBatter) => number | null) => {
    const xs = rows.map(pick).filter((n): n is number => n != null && Number.isFinite(n));
    return xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : null;
  };
  const pits = [...pitchers.values()].filter((p) => p.pa >= 60);
  const pavg = (pick: (p: SavantPitcher) => number | null) => {
    const xs = pits.map(pick).filter((n): n is number => n != null && Number.isFinite(n));
    return xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : null;
  };
  return {
    barrel: avg((b) => b.barrel) ?? DEFAULT_LEAGUE.barrel,
    ev: avg((b) => b.ev) ?? DEFAULT_LEAGUE.ev,
    xIso: avg((b) => b.xIso) ?? DEFAULT_LEAGUE.xIso,
    pull: avg((b) => b.pull) ?? DEFAULT_LEAGUE.pull,
    flyBall: avg((b) => b.flyBall) ?? DEFAULT_LEAGUE.flyBall,
    hardHit: avg((b) => b.hardHit) ?? DEFAULT_LEAGUE.hardHit,
    swingSpeed: avg((b) => b.swingSpeed) ?? DEFAULT_LEAGUE.swingSpeed,
    solid: avg((b) => b.solid) ?? DEFAULT_LEAGUE.solid,
    inZone: pavg((p) => p.inZone) ?? DEFAULT_LEAGUE.inZone,
    edge: pavg((p) => p.edge) ?? DEFAULT_LEAGUE.edge,
    kPct: pavg((p) => p.kPct) ?? DEFAULT_LEAGUE.kPct,
    whiff: pavg((p) => p.whiff) ?? DEFAULT_LEAGUE.whiff,
    sweetSpot: avg((b) => b.sweetSpot) ?? DEFAULT_LEAGUE.sweetSpot,
    blast: avg((b) => b.blast) ?? DEFAULT_LEAGUE.blast,
  };
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      row[key] = cols[c] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        q = !q;
      }
    } else if (ch === "," && !q) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v.replace(/^\./, "0."));
  return Number.isFinite(n) ? n : null;
}

function int(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchWeekContact(
  season: number,
  from: string,
  toExclusive: string,
): Promise<Map<number, WeekContact>> {
  const url =
    `https://baseballsavant.mlb.com/statcast_search/csv?all=true` +
    `&hfSea=${season}%7C&hfGT=R%7C&player_type=batter` +
    `&hfBBT=fly%5C.%5C.ball%7Cline%5C.%5C.drive%7Cground%5C.%5C.ball%7Cpopup%7C` +
    `&game_date_gt=${from}&game_date_lt=${toExclusive}` +
    `&min_pitches=0&min_results=0&type=details`;
  try {
    const res = await fetch(url, { headers: SAVANT_HEADERS });
    if (!res.ok) throw new Error(`Savant week ${res.status}`);
    const text = await res.text();
    return aggregateWeek(text, toExclusive);
  } catch {
    return new Map();
  }
}

function emptySide(): SideContact {
  return { bbe: 0, barrels: 0 };
}

function emptyWeek(): WeekContact {
  return {
    bbe: 0,
    barrels: 0,
    solid: 0,
    weak: 0,
    evSum: 0,
    batSpeedSum: 0,
    batSpeedN: 0,
    pullN: 0,
    pull: 0,
    pullAir: 0,
    aaN: 0,
    idealAa: 0,
    launchN: 0,
    launchSum: 0,
    vsL: emptySide(),
    vsR: emptySide(),
    vsHard: emptySide(),
    vsBreak: emptySide(),
    vsOff: emptySide(),
    byPitch: {},
    heart: emptySide(),
    chase: emptySide(),
    games: [],
    tanks: 0,
  };
}

function aggregateWeek(text: string, beforeDate?: string): Map<number, WeekContact> {
  const map = new Map<number, WeekContact>();
  const gameMaps = new Map<number, Map<string, GameEv>>();
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length < 2) return map;
  const header = splitCsvLine(lines[0]);
  const iBatter = header.indexOf("batter");
  const iThrows = header.indexOf("p_throws");
  const iEv = header.indexOf("launch_speed");
  const iCode = header.indexOf("launch_speed_angle");
  const iPitch = header.indexOf("pitch_type");
  const iBat = header.indexOf("bat_speed");
  const iDate = header.indexOf("game_date");
  const iZone = header.indexOf("zone");
  const iStand = header.indexOf("stand");
  const iHcX = header.indexOf("hc_x");
  const iHcY = header.indexOf("hc_y");
  const iBb = header.indexOf("bb_type");
  const iLa = header.indexOf("launch_angle");
  const iAa = header.indexOf("attack_angle");
  if (iBatter < 0 || iEv < 0) return map;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cols = splitCsvLine(lines[i]);
    const id = int(cols[iBatter]);
    const ev = Number(cols[iEv]);
    if (!id || !Number.isFinite(ev) || ev <= 0) continue;
    const date = iDate >= 0 ? (cols[iDate] ?? "").slice(0, 10) : "";
    if (beforeDate && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= beforeDate) continue;
    let row = map.get(id);
    if (!row) {
      row = emptyWeek();
      map.set(id, row);
    }
    const code = iCode >= 0 ? cols[iCode] : "";
    const barrel = code === "6";
    row.bbe += 1;
    row.evSum += ev;
    if (barrel) row.barrels += 1;
    if (code === "5") row.solid += 1;
    if (code === "1") row.weak += 1;
    if (iBat >= 0) {
      const spd = Number(cols[iBat]);
      if (Number.isFinite(spd) && spd >= 50) {
        row.batSpeedSum += spd;
        row.batSpeedN += 1;
      }
    }
    const hand = iThrows >= 0 ? cols[iThrows] : "";
    if (hand === "L") {
      row.vsL.bbe += 1;
      if (barrel) row.vsL.barrels += 1;
    } else if (hand === "R") {
      row.vsR.bbe += 1;
      if (barrel) row.vsR.barrels += 1;
    }
    const pitch = iPitch >= 0 ? (cols[iPitch] ?? "").toUpperCase() : "";
    const fam = pitchFamily(pitch);
    if (fam) {
      fam === "hard" ? bump(row.vsHard, barrel) : fam === "break" ? bump(row.vsBreak, barrel) : bump(row.vsOff, barrel);
    }
    if (pitch) {
      let bp = row.byPitch[pitch];
      if (!bp) {
        bp = emptySide();
        row.byPitch[pitch] = bp;
      }
      bump(bp, barrel);
    }
    const zone = iZone >= 0 ? int(cols[iZone]) : 0;
    if (zone >= 4 && zone <= 6) bump(row.heart, barrel);
    else if (zone >= 11 && zone <= 14) bump(row.chase, barrel);
    if (iAa >= 0) {
      const aa = Number(cols[iAa]);
      if (Number.isFinite(aa) && aa > -90 && aa < 90) {
        row.aaN += 1;
        if (aa >= 5 && aa <= 20) row.idealAa += 1;
      }
    }
    const la = iLa >= 0 ? Number(cols[iLa]) : NaN;
    const hasLa = Number.isFinite(la) && la > -90 && la < 90;
    if (hasLa) {
      row.launchN += 1;
      row.launchSum += la;
    }
    const stand = iStand >= 0 ? (cols[iStand] ?? "").toUpperCase() : "";
    const hcX = iHcX >= 0 ? Number(cols[iHcX]) : NaN;
    const hcY = iHcY >= 0 ? Number(cols[iHcY]) : NaN;
    const spray = sprayDeg(hcX, hcY);
    let pulled = false;
    if (spray != null && (stand === "L" || stand === "R")) {
      row.pullN += 1;
      pulled = stand === "L" ? spray >= 15 : spray <= -15;
      if (pulled) {
        row.pull += 1;
        const bb = iBb >= 0 ? (cols[iBb] ?? "").toLowerCase().replace(/\s+/g, "_") : "";
        if (bb === "fly_ball" || bb === "line_drive") row.pullAir += 1;
      }
    }
    const tank = hasLa && isTank(ev, la, pulled);
    if (tank) row.tanks += 1;
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      let gm = gameMaps.get(id);
      if (!gm) {
        gm = new Map();
        gameMaps.set(id, gm);
      }
      let g = gm.get(date);
      if (!g) {
        g = { date, maxEv: ev, n100: 0, nTanks: 0, bbe: 0, launchSum: 0, nLaunch2030: 0 };
        gm.set(date, g);
      }
      g.bbe += 1;
      if (ev > g.maxEv) g.maxEv = ev;
      if (ev >= 100) g.n100 += 1;
      if (tank) g.nTanks += 1;
      if (hasLa) {
        g.launchSum += la;
        if (la >= 20 && la <= 30) g.nLaunch2030 += 1;
      }
    }
  }
  for (const [id, row] of map) {
    const gm = gameMaps.get(id);
    if (gm) {
      row.games = [...gm.values()].sort((a, b) => b.date.localeCompare(a.date));
    }
  }
  return map;
}

function bump(side: SideContact, barrel: boolean) {
  side.bbe += 1;
  if (barrel) side.barrels += 1;
}

function sprayDeg(hcX: number, hcY: number): number | null {
  if (!Number.isFinite(hcX) || !Number.isFinite(hcY)) return null;
  const dx = hcX - 125.42;
  const dy = 198.27 - hcY;
  if (Math.abs(dy) < 1) return null;
  return (Math.atan(dx / dy) * 180) / Math.PI;
}

export function pitchFamily(code: string): "hard" | "break" | "off" | null {
  const c = code.toUpperCase();
  if (!c) return null;
  if (c === "FF" || c === "SI" || c === "FC" || c === "FA") return "hard";
  if (c === "SL" || c === "ST" || c === "CU" || c === "KC" || c === "SV" || c === "CS") return "break";
  if (c === "CH" || c === "FS" || c === "KN" || c === "EP" || c === "FO") return "off";
  return null;
}

export type PitchSlice = {
  code: string;
  name: string;
  n: number;
  pct: number;
  barrelPct: number | null;
  ev: number | null;
  iso: number | null;
  woba: number | null;
  hr: number;
};

export type PitchMatrixBundle = {
  from: string;
  to: string;
  batters: Map<number, PitchSlice[]>;
  pitchers: Map<number, PitchSlice[]>;
};

type PitchAcc = {
  n: number;
  barrels: number;
  evSum: number;
  evN: number;
  isoSum: number;
  wobaSum: number;
  wobaN: number;
  hr: number;
};

const CODE_LABEL: Record<string, string> = {
  FF: "4S-FB",
  FA: "4S-FB",
  SI: "Sinker",
  FC: "Cutter",
  SL: "Slider",
  ST: "Sweeper",
  CU: "Curve",
  KC: "KnCurve",
  CH: "Changeup",
  FS: "Split",
  SV: "Sweeper",
  CS: "Curve",
  KN: "Knuckle",
  EP: "Eephus",
  FO: "Fork",
  SC: "Screw",
};

const NAME_CODE: Record<string, string> = {
  "4-SEAM FASTBALL": "FF",
  "FOUR-SEAM FASTBALL": "FF",
  "4-SEAM": "FF",
  SINKER: "SI",
  "2-SEAM FASTBALL": "SI",
  "TWO-SEAM FASTBALL": "SI",
  CUTTER: "FC",
  SLIDER: "SL",
  SWEEPER: "ST",
  CURVEBALL: "CU",
  CURVE: "CU",
  "KNUCKLE CURVE": "KC",
  "KNUCKLE-CURVE": "KC",
  CHANGEUP: "CH",
  "CHANGE-UP": "CH",
  "SPLIT-FINGER": "FS",
  SPLITTER: "FS",
  SLURVE: "SV",
  KNUCKLEBALL: "KN",
  EEPHUS: "EP",
  FORKBALL: "FO",
  SCREWBALL: "SC",
};

export function pitchLabel(code: string): string {
  return CODE_LABEL[canonPitch(code)] ?? code;
}

function canonPitch(code: string): string {
  const c = code.toUpperCase();
  if (c === "FA") return "FF";
  if (c === "FT") return "SI";
  return c;
}

function codeFromName(name: string): string {
  return NAME_CODE[name.trim().toUpperCase()] ?? "";
}

function emptyAcc(): PitchAcc {
  return { n: 0, barrels: 0, evSum: 0, evN: 0, isoSum: 0, wobaSum: 0, wobaN: 0, hr: 0 };
}

export async function fetchPitchMatrix(from: string, toExclusive: string, season: number): Promise<PitchMatrixBundle> {
  const empty: PitchMatrixBundle = { from, to: toExclusive, batters: new Map(), pitchers: new Map() };
  const url =
    `https://baseballsavant.mlb.com/statcast_search/csv?all=true` +
    `&hfSea=${season}%7C&hfGT=R%7C&player_type=batter` +
    `&hfBBT=fly%5C.%5C.ball%7Cline%5C.%5C.drive%7Cground%5C.%5C.ball%7Cpopup%7C` +
    `&game_date_gt=${from}&game_date_lt=${toExclusive}` +
    `&min_pitches=0&min_results=0&type=details`;
  try {
    const res = await fetch(url, { headers: SAVANT_HEADERS });
    if (!res.ok) throw new Error(`Savant matrix ${res.status}`);
    const text = await res.text();
    return aggregatePitchMatrix(text, from, toExclusive);
  } catch {
    return empty;
  }
}

function aggregatePitchMatrix(text: string, from: string, to: string): PitchMatrixBundle {
  const batters = new Map<number, Record<string, PitchAcc>>();
  const pitchers = new Map<number, Record<string, PitchAcc>>();
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length < 2) return { from, to, batters: new Map(), pitchers: new Map() };
  const header = splitCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, ""));
  const iType = header.indexOf("pitch_type");
  const iName = header.indexOf("pitch_name");
  const iBatter = header.indexOf("batter");
  const iPitcher = header.indexOf("pitcher");
  const iEv = header.indexOf("launch_speed");
  const iCode = header.indexOf("launch_speed_angle");
  const iIso = header.indexOf("iso_value");
  const iWoba = header.indexOf("woba_value");
  const iXwoba = header.indexOf("estimated_woba_using_speedangle");
  const iEvents = header.indexOf("events");
  if (iBatter < 0 || iEv < 0) return { from, to, batters: new Map(), pitchers: new Map() };

  const bump = (store: Map<number, Record<string, PitchAcc>>, id: number, code: string, row: string[]) => {
    if (!id || !code) return;
    let accs = store.get(id);
    if (!accs) {
      accs = {};
      store.set(id, accs);
    }
    let a = accs[code];
    if (!a) {
      a = emptyAcc();
      accs[code] = a;
    }
    a.n += 1;
    if (iCode >= 0 && row[iCode] === "6") a.barrels += 1;
    const ev = Number(row[iEv]);
    if (Number.isFinite(ev) && ev > 0) {
      a.evSum += ev;
      a.evN += 1;
    }
    if (iIso >= 0) {
      const iso = Number(row[iIso]);
      if (Number.isFinite(iso)) a.isoSum += iso;
    }
    const wobaRaw = iWoba >= 0 ? Number(row[iWoba]) : NaN;
    const xwoba = iXwoba >= 0 ? Number(row[iXwoba]) : NaN;
    const w = Number.isFinite(wobaRaw) ? wobaRaw : xwoba;
    if (Number.isFinite(w)) {
      a.wobaSum += w;
      a.wobaN += 1;
    }
    if (iEvents >= 0 && (row[iEvents] ?? "").toLowerCase() === "home_run") a.hr += 1;
  };

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cols = splitCsvLine(lines[i]);
    const ev = Number(cols[iEv]);
    if (!Number.isFinite(ev) || ev <= 0) continue;
    const type = iType >= 0 ? (cols[iType] ?? "").toUpperCase() : "";
    const name = iName >= 0 ? (cols[iName] ?? "") : "";
    const code = canonPitch(type && CODE_LABEL[canonPitch(type)] ? type : codeFromName(name) || type);
    if (!code) continue;
    bump(batters, int(cols[iBatter]), code, cols);
    if (iPitcher >= 0) bump(pitchers, int(cols[iPitcher]), code, cols);
  }

  return {
    from,
    to,
    batters: finalizeSlices(batters),
    pitchers: finalizeSlices(pitchers),
  };
}

function finalizeSlices(store: Map<number, Record<string, PitchAcc>>): Map<number, PitchSlice[]> {
  const out = new Map<number, PitchSlice[]>();
  for (const [id, accs] of store) {
    const total = Object.values(accs).reduce((s, a) => s + a.n, 0) || 1;
    const rows = Object.entries(accs)
      .map(([code, a]) => ({
        code,
        name: pitchLabel(code),
        n: a.n,
        pct: a.n / total,
        barrelPct: a.n ? (100 * a.barrels) / a.n : null,
        ev: a.evN ? a.evSum / a.evN : null,
        iso: a.n ? a.isoSum / a.n : null,
        woba: a.wobaN ? a.wobaSum / a.wobaN : null,
        hr: a.hr,
      }))
      .sort((a, b) => b.n - a.n);
    out.set(id, rows);
  }
  return out;
}

export async function fetchPitchersMatrix(
  ids: number[],
  from: string,
  toExclusive: string,
  season: number,
): Promise<Map<number, PitchSlice[]>> {
  const unique = [...new Set(ids.filter((id) => id > 0))];
  const out = new Map<number, PitchSlice[]>();
  const POOL = 4;
  for (let i = 0; i < unique.length; i += POOL) {
    const batch = unique.slice(i, i + POOL);
    const parts = await Promise.all(batch.map((id) => fetchOnePitcher(id, from, toExclusive, season)));
    for (let j = 0; j < batch.length; j++) {
      const rows = parts[j];
      if (rows.length) out.set(batch[j], rows);
    }
  }
  return out;
}

async function fetchOnePitcher(
  id: number,
  from: string,
  toExclusive: string,
  season: number,
): Promise<PitchSlice[]> {
  const url =
    `https://baseballsavant.mlb.com/statcast_search/csv?all=true` +
    `&hfSea=${season}%7C&hfGT=R%7C&player_type=pitcher&pitchers_lookup%5B%5D=${id}` +
    `&hfBBT=fly%5C.%5C.ball%7Cline%5C.%5C.drive%7Cground%5C.%5C.ball%7Cpopup%7C` +
    `&game_date_gt=${from}&game_date_lt=${toExclusive}` +
    `&min_pitches=0&min_results=0&type=details`;
  try {
    const res = await fetch(url, { headers: SAVANT_HEADERS });
    if (!res.ok) return [];
    const text = await res.text();
    const bundle = aggregatePitchMatrix(text, from, toExclusive);
    return bundle.pitchers.get(id) ?? [];
  } catch {
    return [];
  }
}

export function alignPitchRows(
  order: Array<{ code: string; pct: number }> | null,
  slices: PitchSlice[] | undefined,
  useArsenalPct: boolean,
  limit = 5,
): PitchSlice[] {
  const byCode = new Map((slices ?? []).map((s) => [canonPitch(s.code), s]));
  const rows: PitchSlice[] = [];
  const used = new Set<string>();
  if (order) {
    for (const a of order) {
      if (rows.length >= limit) break;
      const code = canonPitch(a.code);
      const hit = byCode.get(code);
      rows.push(
        hit
          ? { ...hit, code, name: pitchLabel(code), pct: useArsenalPct ? a.pct : hit.pct }
          : {
              code,
              name: pitchLabel(code),
              n: 0,
              pct: useArsenalPct ? a.pct : 0,
              barrelPct: null,
              ev: null,
              iso: null,
              woba: null,
              hr: 0,
            },
      );
      used.add(code);
    }
  }
  if (rows.length < 3) {
    for (const s of slices ?? []) {
      if (used.has(s.code)) continue;
      rows.push(s);
      used.add(s.code);
      if (rows.length >= limit) break;
    }
  }
  return rows;
}
