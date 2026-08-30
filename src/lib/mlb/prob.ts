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
export const LEAGUE_TBF_PER_START = 22.8;
export const STARTER_HR_RATE = 0.077;
export const DAMPING = 0.62;
export const TAIL_CUT = 0.16;
export const TAIL_KEEP = 0.55;
export const P_HR_CAP = 0.22;
export const MODEL_VERSION = "v13-tank";

export const CAL_BANDS = [
  { label: "Under 8%", min: 0, max: 0.08 },
  { label: "8–12%", min: 0.08, max: 0.12 },
  { label: "12–16%", min: 0.12, max: 0.16 },
  { label: "16–20%", min: 0.16, max: 0.2 },
  { label: "20%+", min: 0.2, max: 1.01 },
] as const;

export function trustWeight(conf: number): number {
  return 0.8 + 0.18 * clamp(conf, 0.3, 0.97);
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
