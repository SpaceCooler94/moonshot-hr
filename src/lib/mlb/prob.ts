export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function shrinkRate(
  successes: number,
  trials: number,
  prior: number,
  priorN: number,
): number {
  const t = trials + priorN;
  if (t <= 0) return prior;
  return (successes + prior * priorN) / t;
}

/** Barrel% is a rate. Shrink it toward league with BBE as trials, not PA. */
export function shrinkBarrelPct(
  barrelPct: number,
  barrels: number | null | undefined,
  pa: number,
  lg = 7.1,
): number {
  const prior = lg / 100;
  if (barrels != null && barrels > 0 && barrelPct > 0) {
    const bbe = barrels / (barrelPct / 100);
    if (bbe >= 8) return 100 * shrinkRate(barrels, bbe, prior, 80);
  }
  const bbe = Math.max(pa * 0.22, 1);
  return 100 * shrinkRate((barrelPct / 100) * bbe, bbe, prior, 80);
}

const PA_BY_ORDER = [4.52, 4.42, 4.32, 4.22, 4.1, 3.96, 3.82, 3.68, 3.55];
export const LEAGUE_TBF_PER_START = 22.8;
export const STARTER_HR_RATE = 0.077;
/** League batter-game P(≥1 HR). Walk-forward y is game HR, not vs-starter. */
export const GAME_HR_RATE = 0.11;
/** Log-compress the matchup stack. 0.62 pinned the top of the board in a 0.7pt band. */
export const DAMPING = 0.85;
export const P_HR_CAP = 0.18;
export const P_HR_FLOOR = 0.02;
export const MODEL_VERSION = "v17-logit";

export const CAL_BANDS = [
  { label: "Under 8%", min: 0, max: 0.08 },
  { label: "8–12%", min: 0.08, max: 0.12 },
  { label: "12–16%", min: 0.12, max: 0.16 },
  { label: "16–22%", min: 0.16, max: 0.22 },
  { label: ">22%", min: 0.22, max: 1.01 },
] as const;

export type ReliabilityBand = {
  label: string;
  n: number;
  meanP: number;
  actualRate: number;
  thin: boolean;
};

/** Reliability by probability band. n<500 is decoration, not a calibration claim. */
export function reliabilityBands(rows: Array<{ pHr: number; y: 0 | 1 }>): ReliabilityBand[] {
  return CAL_BANDS.map((b) => {
    const xs = rows.filter((r) => r.pHr >= b.min && r.pHr < b.max);
    const n = xs.length;
    return {
      label: b.label,
      n,
      meanP: n ? xs.reduce((s, r) => s + r.pHr, 0) / n : 0,
      actualRate: n ? xs.reduce((s, r) => s + r.y, 0) / n : 0,
      thin: n < 500,
    };
  }).filter((b) => b.n > 0);
}

/** Poisson-binomial: sum p vs count, 95% band. */
export function calibInLarge(rows: Array<{ pHr: number; y: 0 | 1 }>): {
  n: number;
  pred: number;
  actual: number;
  se: number;
  inside95: boolean;
} {
  const n = rows.length;
  if (n === 0) return { n: 0, pred: 0, actual: 0, se: 0, inside95: true };
  const pred = rows.reduce((s, r) => s + r.pHr, 0);
  const actual = rows.reduce((s, r) => s + r.y, 0);
  const se = Math.sqrt(rows.reduce((s, r) => s + r.pHr * (1 - r.pHr), 0));
  return { n, pred, actual, se, inside95: Math.abs(actual - pred) <= 1.96 * se };
}

export function trustWeight(conf: number): number {
  return 0.8 + 0.18 * clamp(conf, 0.3, 0.97);
}

export function publishPHr(pHrRaw: number, conf: number, prior = GAME_HR_RATE): number {
  const base = clamp(prior, 0.04, 0.13);
  const trust = trustWeight(conf);
  const p = base + (pHrRaw - base) * trust;
  return clamp(p, P_HR_FLOOR, P_HR_CAP);
}

export function expectedPa(order: number): number {
  const idx = Math.min(8, Math.max(0, Math.round(order) - 1));
  return PA_BY_ORDER[idx] ?? 4;
}

export function starterTbf(bf: number | null | undefined, gs: number | null | undefined): number {
  const lg = LEAGUE_TBF_PER_START;
  if (gs != null && gs >= 1 && bf != null && bf > 0) {
    const raw = clamp(bf / gs, 15, 28);
    const prior = gs >= 5 ? 6 : 10;
    const shrunk = (raw * gs + lg * prior) / (gs + prior);
    return clamp(shrunk, 16, 27);
  }
  return lg;
}

export function paVsStarter(order: number, tbf: number): number {
  const slot = Math.min(9, Math.max(1, Math.round(order)));
  const lineup = PA_BY_ORDER.reduce((s, x) => s + x, 0);
  const share = (PA_BY_ORDER[slot - 1] ?? 4) / lineup;
  return clamp(tbf * share, 1.2, 4.4);
}

export function pAtLeastOne(pPa: number, pa: number): number {
  const p = clamp(pPa, 0.0004, 0.18);
  return 1 - Math.pow(1 - p, pa);
}

/** P(≥1 HR in the game): starter PA at matchup rate, leftover PA at league pen rate. */
export function pGameHr(pHrPa: number, paStarter: number, gamePa: number, pPenPa: number): number {
  const vs = Math.max(0, paStarter);
  const leftover = Math.max(0, gamePa - vs);
  const pSp = clamp(pHrPa, 0, 0.18);
  const pPen = clamp(pPenPa, 0, 0.18);
  const pNo = Math.pow(1 - pSp, vs) * Math.pow(1 - pPen, leftover);
  return clamp(1 - pNo, 0, 1);
}

/** Poisson P(X ≥ 2) with λ = PA × p(HR/PA). Rare-event 2+ HR. */
export function pAtLeastTwo(pPa: number, pa: number): number {
  const lambda = clamp(pa, 1, 5) * clamp(pPa, 0.0004, 0.18);
  return clamp(1 - Math.exp(-lambda) * (1 + lambda), 0, 0.2);
}
