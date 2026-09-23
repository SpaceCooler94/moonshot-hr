export type WindowSplit = {
  games: number;
  hr: number;
  ab: number;
  pa: number;
  h: number;
  tb: number;
  slg: number | null;
  ops: number | null;
};

export type GameLogRow = {
  date: string;
  oppId: number;
  hr: number;
  ab: number;
  pa: number;
  h: number;
  tb: number;
  bb: number;
  hbp: number;
  sf: number;
};

export type SplitBoard = {
  g3: WindowSplit;
  g5: WindowSplit;
  g10: WindowSplit;
  g20: WindowSplit;
  season: WindowSplit;
  vsOpp: {
    id: number;
    abbr: string;
    g3: WindowSplit;
    g5: WindowSplit;
    g10: WindowSplit;
    g20: WindowSplit;
    season: WindowSplit;
  } | null;
};

export function logsBefore(rows: GameLogRow[], date: string): GameLogRow[] {
  return rows.filter((r) => r.date < date);
}

export function peelGame(
  seasonHr: number,
  seasonPa: number,
  log?: GameLogRow | null,
  boxHr?: number | null,
): { hr: number; pa: number } {
  if (log) {
    return {
      hr: Math.max(0, seasonHr - (Number.isFinite(log.hr) ? log.hr : 0)),
      pa: Math.max(0, seasonPa - (Number.isFinite(log.pa) ? log.pa : 0)),
    };
  }
  if (boxHr != null && Number.isFinite(boxHr)) {
    return { hr: Math.max(0, seasonHr - boxHr), pa: Math.max(0, seasonPa - 4) };
  }
  return { hr: seasonHr, pa: seasonPa };
}

export function emptyWindow(): WindowSplit {
  return { games: 0, hr: 0, ab: 0, pa: 0, h: 0, tb: 0, slg: null, ops: null };
}

export function rollWindow(rows: GameLogRow[], n?: number): WindowSplit {
  const xs = n == null ? rows : rows.slice(0, n);
  if (xs.length === 0) return emptyWindow();
  let hr = 0;
  let ab = 0;
  let pa = 0;
  let h = 0;
  let tb = 0;
  let bb = 0;
  let hbp = 0;
  let sf = 0;
  for (const r of xs) {
    hr += r.hr;
    ab += r.ab;
    pa += r.pa;
    h += r.h;
    tb += r.tb;
    bb += r.bb;
    hbp += r.hbp;
    sf += r.sf;
  }
  const obpDen = ab + bb + hbp + sf;
  return {
    games: xs.length,
    hr,
    ab,
    pa,
    h,
    tb,
    slg: ab > 0 ? tb / ab : null,
    ops: ab > 0 && obpDen > 0 ? tb / ab + (h + bb + hbp) / obpDen : null,
  };
}

export function buildSplits(rows: GameLogRow[], oppId?: number | null, oppAbbr?: string | null): SplitBoard {
  const newest = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const vs = oppId ? newest.filter((r) => r.oppId === oppId) : [];
  return {
    g3: rollWindow(newest, 3),
    g5: rollWindow(newest, 5),
    g10: rollWindow(newest, 10),
    g20: rollWindow(newest, 20),
    season: rollWindow(newest),
    vsOpp:
      oppId && oppAbbr
        ? {
            id: oppId,
            abbr: oppAbbr,
            g3: rollWindow(vs, 3),
            g5: rollWindow(vs, 5),
            g10: rollWindow(vs, 10),
            g20: rollWindow(vs, 20),
            season: rollWindow(vs),
          }
        : null,
  };
}

export function splitLine(w: WindowSplit, label: string): string {
  if (w.games === 0) return `${label}: no games.`;
  if (w.hr >= 3) return `${label}: ${w.hr} HR in ${w.games} — that's hot.`;
  if (w.hr >= 2) return `${label}: ${w.hr} HR in ${w.games}. Live.`;
  if (w.hr === 1) return `${label}: 1 HR in ${w.games}.`;
  return `${label}: 0 HR in ${w.games}. Quiet.`;
}
