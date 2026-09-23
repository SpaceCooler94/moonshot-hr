import { findKeyMatch } from "./signal.ts";
import type { KeyPitchMatch, PlayerPrediction } from "./types.ts";
import { clamp } from "./prob.ts";

/** Tango cuts. Qualifiers, not a price. */
export const BARREL_CUT = 12;
export const PARK_AIR_CUT = 108;
export const ORDER_CUT = 6;
/** LOOK needs the lights AND this score. Asserted gate — not a fitted cut. */
export const LOOK_SCORE_CUT = 0.55;
export const WATCH_SCORE_CUT = 0.38;

export type LookCall = "look" | "watch" | "sit";

export type LookBit = { on: boolean; label: string; line: string; weight: number; score: number };

export type LookGrade = {
  call: LookCall;
  title: string;
  why: string;
  score: number;
  power: LookBit;
  mix: LookBit;
  park: LookBit;
  order: LookBit;
};

/** Additive stack only. Order is a hard qualifier; PA lives in P, not here. */
const W = { power: 0.4, mix: 0.35, park: 0.25 } as const;

function unit(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0;
  return clamp((v - lo) / (hi - lo), 0, 1);
}

/** How much this bat actually does damage. League barrels ~7–8%. */
export function talentScore(barrel: number | null): number {
  if (barrel == null) return 0.2;
  return unit(barrel, 5, 20);
}

/** Usage × barrels on a pitch he actually throws. Unknown mix is 0.25, not zero. */
export function mixScoreOf(key: KeyPitchMatch | null): number {
  if (!key) return 0.25;
  const usage = unit(key.usage, 0.08, 0.38);
  const brl = key.barrelPct == null ? 0.3 : unit(key.barrelPct, 5, 22);
  const raw = 0.45 * usage + 0.55 * brl;
  return key.loud ? Math.max(raw, 0.62) : raw;
}

export function parkScoreOf(air: number): number {
  return unit(air, 90, 122);
}

export function lookScore(input: {
  barrel: number | null;
  key: KeyPitchMatch | null;
  air: number;
}): { total: number; power: number; mix: number; park: number } {
  const power = talentScore(input.barrel);
  const mix = mixScoreOf(input.key);
  const park = parkScoreOf(input.air);
  const total = W.power * power + W.mix * mix + W.park * park;
  return { total, power, mix, park };
}

export function gradeLook(p: PlayerPrediction): LookGrade {
  if (p.lookCall && p.lookWhy) {
    const call = p.lookCall;
    const bits = p.lookBits;
    const total = p.lookScore ?? 0;
    return {
      call,
      title: call === "look" ? "LOOK" : call === "watch" ? "WATCH" : "SIT",
      why: p.lookWhy,
      score: total,
      power: {
        on: bits?.power ?? false,
        label: "Power",
        weight: W.power,
        score: bits?.power ? 1 : 0,
        line: bits?.power ? "Barrels at the cut." : "Below the barrel cut.",
      },
      mix: {
        on: bits?.mix ?? false,
        label: "Mix",
        weight: W.mix,
        score: bits?.mix ? 1 : 0,
        line: bits?.mix ? "He punishes a pitch this guy throws." : "No loud pitch hole.",
      },
      park: {
        on: bits?.park ?? false,
        label: "Park",
        weight: W.park,
        score: bits?.park ? 1 : 0,
        line: bits?.park ? "Air carries tonight." : "Not a launch park.",
      },
      order: {
        on: bits?.order ?? false,
        label: "Order",
        weight: 0,
        score: bits?.order ? 1 : 0,
        line: bits?.order ? "1–6. Qualifier — PA is already in P." : "Too deep. PA is already in P.",
      },
    };
  }

  const barrel = p.statcast?.barrel ?? null;
  const key = findKeyMatch(p);
  const air = p.park.airIndex;
  const scored = lookScore({ barrel, key, air });
  const powerOn = barrel != null && barrel >= BARREL_CUT;
  const mixOn = !!key?.loud;
  const parkOn = air >= PARK_AIR_CUT;
  const orderOn = p.battingOrder >= 1 && p.battingOrder <= ORDER_CUT;

  const power: LookBit = {
    on: powerOn,
    label: "Power",
    weight: W.power,
    score: scored.power,
    line:
      barrel == null
        ? "No barrel sample."
        : powerOn
          ? `${barrel.toFixed(0)}% barrels — that's a power bat (cut ${BARREL_CUT}%).`
          : `${barrel.toFixed(0)}% barrels — below the ${BARREL_CUT}% cut.`,
  };
  const mix: LookBit = {
    on: mixOn,
    label: "Mix",
    weight: W.mix,
    score: scored.mix,
    line:
      mixOn && key
        ? `${key.name} ${key.barrelPct?.toFixed(0) ?? "—"}% BRL · he throws it ${Math.round(key.usage * 100)}%.`
        : key
          ? `${key.name} is ${Math.round(key.usage * 100)}% of the card — not a loud hole.`
          : p.pitcher
            ? `vs ${p.pitcher.name} — no pitch hole yet.`
            : "Starter TBD.",
  };
  const park: LookBit = {
    on: parkOn,
    label: "Park",
    weight: W.park,
    score: scored.park,
    line: parkOn ? `${air} air · ${p.park.airLabel}.` : `${air} air — not a launch park tonight.`,
  };
  const order: LookBit = {
    on: orderOn,
    label: "Order",
    weight: 0,
    score: orderOn ? 1 : 0,
    line: `#${p.battingOrder} · ${orderOn ? "1–6. Qualifier — PA is already in P" : "too deep. PA is already in P"}`,
  };

  const lights = powerOn && orderOn && (mixOn || parkOn);
  const call: LookCall = lights && scored.total >= LOOK_SCORE_CUT
    ? "look"
    : scored.total >= WATCH_SCORE_CUT || powerOn || mixOn
      ? "watch"
      : "sit";
  const title = call === "look" ? "LOOK" : call === "watch" ? "WATCH" : "SIT";
  const why =
    call === "look"
      ? [power.line, mixOn ? mix.line : park.line].join(" ")
      : call === "watch"
        ? lights
          ? `The lights are on but the stack is ${Math.round(scored.total * 100)} — need ${Math.round(LOOK_SCORE_CUT * 100)} to look.`
          : `${powerOn ? power.line : mix.line} Not a look until ${!orderOn ? "he's in the 1–6" : !powerOn ? "the barrel cut" : "the mix or the park"} lights.`
        : `${p.lastName || p.name}: no power cut, no mix hole. Sit.`;

  return { call, title, why, score: scored.total, power, mix, park, order };
}

export function lookClass(call: LookCall): string {
  if (call === "look") return "bg-sage-dim text-sage";
  if (call === "watch") return "bg-gold/15 text-gold";
  return "bg-surface-2 text-muted";
}

/** Rank by lane, then tonight's P, then the stack. Barrels alone do not decide the order. */
export function sortLooks(pool: PlayerPrediction[]): PlayerPrediction[] {
  const rank = (p: PlayerPrediction) => {
    const g = gradeLook(p);
    const lane = g.call === "look" ? 0 : g.call === "watch" ? 1 : 2;
    return [lane, -(p.pHr ?? 0), -(g.score ?? 0), p.battingOrder] as const;
  };
  return [...pool].sort((a, b) => {
    const aa = rank(a);
    const bb = rank(b);
    for (let i = 0; i < aa.length; i++) {
      if (aa[i] !== bb[i]) return aa[i] - bb[i];
    }
    return a.name.localeCompare(b.name);
  });
}
