import { applyIsotonic, type Decile, type IsoMap } from "./isotonic.ts";
import { applyStandardizer, sigmoid, type Standardizer } from "./logit.ts";
import { contributions, FEATURES, featureRecord, toRow, type FeatureInput, type FeatureName } from "./hr-features.ts";

export const LOGIT_VERSION = "v17-logit";

export type HrCuts = {
  look: number;
  watch: number;
  /** Empirical hit rate that defined LOOK. */
  lookRate: number;
  /** Mean LOOK cards per night on the calib fold. */
  looksPerNight: number;
  cap: number | null;
  capWhy: string;
};

export type HrArtifact = {
  version: string;
  trainedAt: string;
  priorSeason: number;
  lambda: number;
  features: readonly string[];
  weights: number[];
  intercept: number;
  standardizer: Standardizer;
  isotonic: IsoMap;
  cuts: HrCuts;
  metrics: {
    train: { n: number; brier: number; logloss: number; base: number };
    calib: { n: number; brier: number; logloss: number; base: number; deciles: Decile[] };
    test: { n: number; brier: number; logloss: number; base: number; deciles: Decile[] } | null;
  };
};

export type HrPrediction = {
  pRaw: number;
  p: number;
  tier: "look" | "watch" | "sit";
  contrib: Array<{ name: string; z: number; w: number; wx: number }>;
};

export function applyHr(input: FeatureInput, art: HrArtifact): HrPrediction {
  const rec = featureRecord(input);
  const raw = toRow(rec);
  const z = applyStandardizer(raw, art.standardizer);
  let lp = 0;
  for (let i = 0; i < z.length; i++) lp += z[i] * (art.weights[i] ?? 0);
  const pRaw = sigmoid(lp);
  let p = applyIsotonic(pRaw, art.isotonic);
  if (art.cuts.cap != null && p > art.cuts.cap) p = art.cuts.cap;
  const tier = p >= art.cuts.look ? "look" : p >= art.cuts.watch ? "watch" : "sit";
  return { pRaw, p, tier, contrib: contributions(rec, z, art.weights).slice(0, 8) };
}

export function coeffTable(art: HrArtifact): Array<{ name: string; w: number }> {
  return [
    { name: "intercept", w: art.weights[0] ?? art.intercept },
    ...FEATURES.map((name, i) => ({ name, w: art.weights[i + 1] ?? 0 })),
  ];
}

export type { FeatureName };
