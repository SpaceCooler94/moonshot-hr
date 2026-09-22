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

const PA_BY_ORDER = [4.52, 4.42, 4.32, 4.22, 4.1, 3.96, 3.82, 3.68, 3.55];

/**
 * v14-cal — locked-board vs starter HR, 2026-08-30..2026-09-17.
 * 4,503 lineup looks joined to MLB play-by-play. A HR counts only if the
 * pitcher was that club's first pitcher of the game (starter / opener).
 *
 *   mean published P   8.21%
 *   actual vs starter  6.66%
 *   actual full game  10.55%   (not the target)
 *   top-12 mean P     15.60%
 *   top-12 actual SP  10.96%
 *   OLS  y ~ -0.010 + 0.93 p
 *
 * Published P was hot, especially above 14%. Full-game box HR must not be
 * used to inflate this number — leftover PA to the bullpen is a separate
 * sketch, not the ranked look.
 *
 * grade-slates.ts, trailing 8 days (2026-09-14..09-21), n=1746:
 *   overall meanP 8.13% vs actual 11.34%  (+3.2pp)
 *   top-12  meanP 14.13% vs actual 20.83% (+6.7pp)
 * Model has flipped cold, worst at the top end where TAIL_KEEP engages.
 * TAIL_KEEP raised 0.42 -> 0.65 to let more top-tier signal through.
 */
export const LEAGUE_HR_PA = 0.0304; // 2026 team totals 5281 HR / 173958 PA
export const LEAGUE_HR_BF = 0.0276;
export const LEAGUE_TBF_PER_START = 22.8;
export const STARTER_HR_RATE = 0.067;
export const DAMPING = 0.58;
export const TAIL_CUT = 0.14;
export const TAIL_KEEP = 0.65;
export const P_HR_CAP = 0.2;
export const BATTER_PRIOR_N = 160;
export const PITCHER_PRIOR_N = 240;
export const CONTACT_HR_WEIGHT = 0.3;
export const CONTACT_QS_WEIGHT = 0.7;
export const STAFF_PRIOR = 1.06;
export const TRUST_BASE = 0.62;
export const TRUST_SPAN = 0.28;
export const MODEL_VERSION = "v14-cal";

export const CAL_BANDS = [
  { label: "Under 8%", min: 0, max: 0.08 },
  { label: "8–12%", min: 0.08, max: 0.12 },
  { label: "12–16%", min: 0.12, max: 0.16 },
  { label: "16–20%", min: 0.16, max: 0.2 },
  { label: "20%+", min: 0.2, max: 1.01 },
] as const;

export function trustWeight(conf: number): number {
  return TRUST_BASE + TRUST_SPAN * clamp(conf, 0.3, 0.97);
}

export function publishPHr(pHrRaw: number, conf: number): number {
  const trust = trustWeight(conf);
  let p = STARTER_HR_RATE + (pHrRaw - STARTER_HR_RATE) * trust;
  if (p > TAIL_CUT) p = TAIL_CUT + (p - TAIL_CUT) * TAIL_KEEP;
  return clamp(p, 0.02, P_HR_CAP);
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
  const base = Math.floor(tbf / 9);
  const rem = tbf - base * 9;
  const extra = clamp(rem - (slot - 1), 0, 1);
  return clamp(base + extra, 1.2, 4.2);
}

export function pAtLeastOne(pPa: number, pa: number): number {
  const p = clamp(pPa, 0.0004, 0.18);
  return 1 - Math.pow(1 - p, pa);
}

/** Poisson P(X ≥ 2) with λ = PA × p(HR/PA). Rare-event 2+ HR. */
export function pAtLeastTwo(pPa: number, pa: number): number {
  const lambda = clamp(pa, 1, 5) * clamp(pPa, 0.0004, 0.18);
  return clamp(1 - Math.exp(-lambda) * (1 + lambda), 0, 0.2);
}
