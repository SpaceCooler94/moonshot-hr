import { expectedPa } from "./prob.ts";
import { PARK_HAND, PARK_HR_FACTOR } from "./parks.ts";

/** Closed feature set — train and serve must compute these the same way. */
export const FEATURES = [
  "barrel_prior",
  "hardhit_prior",
  "ev_prior",
  "pullair_prior",
  "xiso_prior",
  "iso_l7",
  "iso_l15",
  "iso_l30",
  "hrpa_l7",
  "hrpa_l15",
  "hrpa_l30",
  "p_hr9_prior",
  "p_barrel_prior",
  "p_fb_prior",
  "p_ev_prior",
  "p_hr9_l5",
  "air_fb",
  "platoon",
  "park",
  "wind_out",
  "temp",
  "exp_pa",
] as const;

export type FeatureName = (typeof FEATURES)[number];

export type GameLog = { date: string; iso: number; hr: number; pa: number; ab: number };

export type BatterPrior = {
  iso: number;
  barrel: number;
  hardhit: number;
  ev: number;
  pullair: number;
  xiso: number;
  vsL: number | null;
  vsR: number | null;
};

export type PitcherPrior = {
  hr9: number;
  barrel: number;
  fb: number;
  ev: number;
};

export type FeatureInput = {
  prior: BatterPrior | null;
  pitcher: PitcherPrior | null;
  logs: GameLog[];
  pitcherLogs: GameLog[];
  bats: "L" | "R" | "S";
  throws: "L" | "R" | "S";
  venueId: number;
  order: number;
  temp: number | null;
  windOut: number | null;
  lg: { iso: number; barrel: number; hardhit: number; ev: number; pullair: number; xiso: number; hrpa: number; hr9: number; fb: number };
};

const SHRINK_AB = 30;
const SHRINK_PA = 40;

function shrink(sum: number, n: number, prior: number, k: number): number {
  return (sum + prior * k) / (n + k);
}

function rollingIso(logs: GameLog[], n: number, prior: number): number {
  const slice = logs.slice(-n);
  const ab = slice.reduce((s, g) => s + g.ab, 0);
  const isoSum = slice.reduce((s, g) => s + g.iso * g.ab, 0);
  return shrink(isoSum, ab, prior, SHRINK_AB);
}

function rollingHrpa(logs: GameLog[], n: number, prior: number): number {
  const slice = logs.slice(-n);
  const pa = slice.reduce((s, g) => s + g.pa, 0);
  const hr = slice.reduce((s, g) => s + g.hr, 0);
  return shrink(hr, pa, prior, SHRINK_PA);
}

function rollingHr9(logs: GameLog[], n: number, prior: number): number {
  const slice = logs.slice(-n);
  const pa = slice.reduce((s, g) => s + g.pa, 0);
  const hr = slice.reduce((s, g) => s + g.hr, 0);
  if (pa <= 0) return prior;
  const raw = (hr / pa) * 38.1;
  return shrink(raw * slice.length, slice.length, prior, 4);
}

export function lgDefault() {
  return {
    iso: 0.155,
    barrel: 8.2,
    hardhit: 40,
    ev: 89,
    pullair: 16,
    xiso: 0.155,
    hrpa: 0.032,
    hr9: 1.15,
    fb: 36,
  };
}

export function log5(pBat: number, pPit: number, pLg: number): number {
  const a = Math.min(0.8, Math.max(0.001, pBat));
  const b = Math.min(0.8, Math.max(0.001, pPit));
  const lg = Math.min(0.8, Math.max(0.001, pLg));
  const num = (a * b) / lg;
  const den = num + ((1 - a) * (1 - b)) / (1 - lg);
  return num / den;
}

export function parkOf(venueId: number, bats: string): number {
  const base = PARK_HR_FACTOR[venueId] ?? 100;
  const hand = PARK_HAND[venueId];
  const extra = hand ? (bats === "L" ? hand.L : bats === "R" ? hand.R : 0) : 0;
  return (base + extra) / 100;
}

export function featureRecord(input: FeatureInput): Record<FeatureName, number> {
  const lg = input.lg;
  const prior = input.prior;
  const pit = input.pitcher;
  const isoP = prior?.iso ?? lg.iso;
  const barrel = prior?.barrel ?? lg.barrel;
  const hardhit = prior?.hardhit ?? lg.hardhit;
  const ev = prior?.ev ?? lg.ev;
  const pullair = prior?.pullair ?? lg.pullair;
  const xiso = prior?.xiso ?? lg.xiso;
  const pHr9 = pit?.hr9 ?? lg.hr9;
  const pBarrel = pit?.barrel ?? lg.barrel;
  const pFb = pit?.fb ?? lg.fb;
  const pEv = pit?.ev ?? lg.ev;
  const vs = input.throws === "L" ? prior?.vsL : prior?.vsR;
  const pBat = vs ?? lg.hrpa;
  const pPit = pHr9 / 38.1;
  const platoon = log5(pBat, pPit, lg.hrpa) - lg.hrpa;
  return {
    barrel_prior: barrel,
    hardhit_prior: hardhit,
    ev_prior: ev,
    pullair_prior: pullair,
    xiso_prior: xiso,
    iso_l7: rollingIso(input.logs, 7, isoP),
    iso_l15: rollingIso(input.logs, 15, isoP),
    iso_l30: rollingIso(input.logs, 30, isoP),
    hrpa_l7: rollingHrpa(input.logs, 7, lg.hrpa),
    hrpa_l15: rollingHrpa(input.logs, 15, lg.hrpa),
    hrpa_l30: rollingHrpa(input.logs, 30, lg.hrpa),
    p_hr9_prior: pHr9,
    p_barrel_prior: pBarrel,
    p_fb_prior: pFb,
    p_ev_prior: pEv,
    p_hr9_l5: rollingHr9(input.pitcherLogs, 5, pHr9),
    air_fb: (pullair / 100) * (pFb / 100),
    platoon,
    park: parkOf(input.venueId, input.bats),
    wind_out: input.windOut ?? 0,
    temp: input.temp ?? 72,
    exp_pa: expectedPa(input.order),
  };
}

export function toRow(rec: Record<FeatureName, number>): number[] {
  return [1, ...FEATURES.map((k) => rec[k])];
}

export function contributions(
  rec: Record<FeatureName, number>,
  z: number[],
  w: number[],
): Array<{ name: string; z: number; w: number; wx: number }> {
  return FEATURES.map((name, i) => {
    const wi = w[i + 1] ?? 0;
    const zi = z[i + 1] ?? 0;
    return { name, z: zi, w: wi, wx: wi * zi };
  }).sort((a, b) => Math.abs(b.wx) - Math.abs(a.wx));
}
