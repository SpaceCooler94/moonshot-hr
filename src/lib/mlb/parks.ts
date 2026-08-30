/** Home venue for each MLB team id. Used to attach 2026 home/away HR/PA to a park. */
export const TEAM_VENUE: Record<number, number> = {
  108: 1,
  109: 15,
  110: 2,
  111: 3,
  112: 17,
  113: 2602,
  114: 5,
  115: 19,
  116: 2394,
  117: 2392,
  118: 7,
  119: 22,
  120: 3309,
  121: 3289,
  133: 2529,
  134: 31,
  135: 2680,
  136: 680,
  137: 2395,
  138: 2889,
  139: 12,
  140: 5325,
  141: 14,
  142: 3312,
  143: 2681,
  144: 4705,
  145: 4,
  146: 4169,
  147: 3313,
  158: 32,
};

/** HR park factors, 100 = league average. Sourced from recent Statcast/FanGraphs 3-year HR indices. */
export const PARK_HR_FACTOR: Record<number, number> = {
  1: 97, // Angel Stadium
  2: 108, // Camden Yards — Statcast HR ~110
  3: 92, // Fenway Park — Statcast HR ~88 (2024-26); Monster eats dingers, doubles spike
  4: 111, // Rate Field
  5: 101, // Progressive Field
  7: 86, // Kauffman Stadium
  12: 93, // Tropicana Field
  14: 104, // Rogers Centre
  15: 106, // Chase Field
  17: 104, // Wrigley Field
  19: 118, // Coors Field
  22: 105, // Dodger Stadium
  31: 84, // PNC Park — Statcast HR ~83; RF gap + river
  32: 104, // American Family Field
  680: 91, // T-Mobile Park
  2392: 104, // Daikin Park (Houston)
  2394: 95, // Comerica Park
  2395: 80, // Oracle Park — Statcast HR ~78; marine layer + deep RC
  2529: 102, // Sutter Health Park (Athletics)
  2602: 116, // Great American Ball Park
  2680: 92, // Petco Park
  2681: 113, // Citizens Bank Park
  2735: 108, // Journey Bank Ballpark / LL Classic
  2889: 93, // Busch Stadium
  3289: 99, // Citi Field
  3309: 100, // Nationals Park
  3312: 97, // Target Field
  3313: 116, // Yankee Stadium — Statcast HR ~118; both corners short
  4169: 95, // loanDepot park
  4705: 103, // Truist Park
  5325: 107, // Globe Life Field
};

/** Extra HR index points by batter hand. After the 3-year HR park, before weather. */
export const PARK_HAND: Record<number, { L: number; R: number }> = {
  2: { L: 8, R: -4 },
  3: { L: -3, R: -5 },
  4: { L: 2, R: 6 },
  19: { L: 2, R: 2 },
  22: { L: 5, R: -2 },
  31: { L: -2, R: -8 },
  680: { L: -4, R: -3 },
  2392: { L: 4, R: 0 },
  2395: { L: -8, R: -4 },
  2602: { L: 4, R: 3 },
  2680: { L: -4, R: -3 },
  2681: { L: 5, R: 2 },
  3313: { L: 6, R: 4 },
  4705: { L: 3, R: 0 },
  5325: { L: 4, R: 1 },
};

/** Blend noisy single-season home/away HR/PA toward the 3-year prior. */
export function shrinkYearPark(threeYear: number, rawYear: number, pa: number): number {
  const n = Math.max(0, pa);
  const w = n / (n + 5000);
  return Math.round(Math.min(128, Math.max(80, threeYear + w * (rawYear - threeYear))));
}

export function parkHrFactor(
  venueId: number | undefined | null,
  bats?: string,
  yearBase?: number | null,
): number {
  if (!venueId) return 100;
  const base = yearBase ?? PARK_HR_FACTOR[venueId] ?? 100;
  const hand = PARK_HAND[venueId];
  if (!hand || !bats) return base;
  if (bats === "S") return base + Math.round((hand.L + hand.R) / 2);
  return base + (bats === "L" ? hand.L : hand.R);
}

export const PARK_NOTES: Record<number, string> = {
  19: "Thin air. The strongest HR environment in baseball.",
  2602: "Great American — compact LF/RF, a true bandbox.",
  3313: "Short in both corners — 314 RF and 318 LF — not just the right-field porch.",
  2681: "Citizens Bank plays small, especially to the gaps.",
  4: "Rate Field still rewards pull-side lift.",
  2395: "Oracle's marine layer and deep right-center kill flies.",
  7: "Kauffman is a graveyard for home runs.",
  31: "PNC's vast RF gap swallows would-be homers.",
  680: "The Seattle marine layer keeps the ball in the yard.",
  2680: "Petco's heavy air is a pitcher-friendly night.",
  12: "The Trop's roof and deep alleys suppress power.",
  3: "The Monster turns RHB homers into doubles. Pesky is short; Fenway still taxes HR both ways.",
};

/** 0 = dome, 1 = fully exposed. Retractable parks sit in between until the roof posts. */
export const PARK_WIND_SENSE: Record<number, number> = {
  12: 0,
  14: 0.35,
  15: 0.35,
  32: 0.4,
  680: 0.45,
  4169: 0.35,
  5325: 0.35,
  17: 1.15,
  19: 1.2,
  2395: 1.1,
  2680: 1.05,
  3313: 1.05,
  2602: 1,
  2681: 1,
  2735: 1.25,
};

export const PARK_ROOF: Record<number, "dome" | "retract" | "open"> = {
  12: "dome",
  14: "retract",
  15: "retract",
  32: "retract",
  680: "retract",
  4169: "retract",
  5325: "retract",
};

export type WindParse = {
  mph: number;
  dir: "out" | "in" | "cross" | "none";
  field: "LF" | "CF" | "RF" | "unk";
};

export function parseWind(wind: string | null | undefined): WindParse {
  const w = wind ?? "";
  const low = w.toLowerCase();
  const mph = Number(/(\d+)\s*mph/i.exec(w)?.[1] ?? 0);
  if (/\bcalm\b|\bnone\b/.test(low) && !/\bout\b|\bin from\b/.test(low)) {
    return { mph: 0, dir: "none", field: "unk" };
  }
  const lToR = /l\s*to\s*r|left to right/.test(low);
  const rToL = /r\s*to\s*l|right to left/.test(low);
  let field: WindParse["field"] = "unk";
  if (/\brf\b|right field|to right|from right/.test(low) && !/left/.test(low)) field = "RF";
  else if (/\blf\b|left field|to left|from left/.test(low)) field = "LF";
  else if (/\bcf\b|center/.test(low)) field = "CF";
  else if (lToR) field = "RF";
  else if (rToL) field = "LF";
  let dir: WindParse["dir"] = "none";
  if (low.includes("out")) dir = "out";
  else if (/\bin\b/.test(low)) dir = "in";
  else if (lToR || rToL) dir = "cross";
  else if (mph >= 6) dir = "cross";
  return { mph, dir, field };
}

export function roofClosed(venueId: number, condition: string | null | undefined): boolean {
  const roof = PARK_ROOF[venueId];
  if (roof === "dome") return true;
  const c = (condition ?? "").toLowerCase();
  if (c.includes("dome") || c.includes("indoor") || c.includes("roof closed")) return true;
  if (roof === "retract" && (c.includes("closed") || c.includes("retractable roof closed"))) return true;
  return false;
}

function pullField(bats: string | undefined): WindParse["field"] {
  if (bats === "L") return "RF";
  if (bats === "R") return "LF";
  return "CF";
}

/** Daily index: 3-year HR park + hand, then today's temp/wind/dew. Spray is applied by the caller. */
export function dailyParkAir(
  venueId: number,
  bats: string | undefined,
  tempStr: string | null | undefined,
  windStr: string | null | undefined,
  condition: string | null | undefined,
  yearBase?: number | null,
  humidity?: number | null,
  dewpoint?: number | null,
): { index: number; deltaHr: number; label: string; closed: boolean } {
  const base = parkHrFactor(venueId, bats, yearBase);
  const bits: string[] = [];
  let pts = 0;
  const temp = Number(tempStr);
  if (Number.isFinite(temp) && temp > 0) {
    pts += (temp - 72) * 0.35;
    bits.push(`${Math.round(temp)}°F`);
  }
  const closed = roofClosed(venueId, condition);
  const wind = parseWind(windStr);
  if (closed) {
    bits.push("roof closed");
  } else if (wind.mph >= 5 && wind.dir !== "none") {
    const sens = PARK_WIND_SENSE[venueId] ?? 1;
    let mag = wind.mph * 0.65 * sens;
    const pull = pullField(bats);
    if (wind.dir === "out") {
      if (wind.field === pull) mag *= 1.35;
      else if (wind.field !== "unk" && wind.field !== "CF" && wind.field !== pull) mag *= 0.7;
    } else if (wind.dir === "in") {
      mag *= -1;
      if (wind.field === pull) mag *= 1.25;
      else if (wind.field !== "unk" && wind.field !== "CF" && wind.field !== pull) mag *= 0.7;
    } else if (wind.dir === "cross") {
      if (pull === "CF") mag *= 0.12;
      else if (wind.field === pull) mag *= 0.45;
      else if (wind.field === "CF" || wind.field === "unk") mag *= 0.12;
      else mag *= -0.45;
    }
    pts += mag;
    const way = wind.dir === "out" ? "out" : wind.dir === "in" ? "in" : "cross";
    const fieldBit = wind.field === "unk" ? "" : `${wind.field} `;
    bits.push(`${way} ${fieldBit}${wind.mph}`.replace(/\s+/g, " ").trim());
  } else if (wind.mph > 0) {
    bits.push(`${wind.mph} mph`);
  }
  if (!closed) {
    if (dewpoint != null && Number.isFinite(dewpoint)) {
      // 3-year park already has climate. This is today's moisture vs a typical MLB evening (~58°F dew).
      // Nathan: water vapor is lighter than dry air — more carry — but small vs temp/altitude.
      const dpts = Math.min(2.5, Math.max(-2, (dewpoint - 58) * 0.04));
      pts += dpts;
      bits.push(`${Math.round(dewpoint)}° dew`);
    } else if (humidity != null && Number.isFinite(humidity)) {
      const hpts = Math.min(2, Math.max(-2, (humidity - 55) * 0.03));
      pts += hpts;
      bits.push(`${Math.round(humidity)}% RH`);
    }
  }
  const index = Math.round(Math.min(142, Math.max(78, base + pts)));
  const deltaHr = (index - 100) / 40;
  return {
    index,
    deltaHr,
    label: `${index} air` + (bits.length ? ` · ${bits.join(" · ")}` : ""),
    closed,
  };
}

/** Pull-air hitters get more of a porch and more of a wall tax. */
export function sprayPark(
  venueId: number,
  bats: string | undefined,
  pull: number | null | undefined,
  flyBall: number | null | undefined,
  lgPull = 40,
  lgFly = 25,
): { pts: number; label: string | null } {
  const hand = PARK_HAND[venueId];
  if (!hand || pull == null || flyBall == null || !bats) return { pts: 0, label: null };
  const porch = bats === "S" ? (hand.L + hand.R) / 2 : bats === "L" ? hand.L : hand.R;
  if (Math.abs(porch) < 3) return { pts: 0, label: null };
  const lg = Math.max((lgPull / 100) * (lgFly / 100), 0.04);
  const pa = (pull / 100) * (flyBall / 100);
  const tilt = Math.min(0.7, Math.max(-0.5, pa / lg - 1));
  const pts = Math.min(8, Math.max(-7, tilt * porch * 0.55));
  if (Math.abs(pts) < 1.2) return { pts: 0, label: null };
  return {
    pts,
    label: pts > 0 ? "pull × porch" : "spray vs wall",
  };
}

/** Typical wall distances, LF / CF / RF in feet. */
export const PARK_FENCE: Record<number, { lf: number; cf: number; rf: number }> = {
  1: { lf: 347, cf: 396, rf: 350 },
  2: { lf: 333, cf: 400, rf: 318 },
  3: { lf: 310, cf: 420, rf: 302 },
  4: { lf: 330, cf: 400, rf: 335 },
  5: { lf: 325, cf: 405, rf: 325 },
  7: { lf: 330, cf: 410, rf: 330 },
  12: { lf: 315, cf: 404, rf: 322 },
  14: { lf: 328, cf: 400, rf: 328 },
  15: { lf: 330, cf: 407, rf: 335 },
  17: { lf: 355, cf: 400, rf: 353 },
  19: { lf: 347, cf: 415, rf: 350 },
  22: { lf: 330, cf: 395, rf: 330 },
  31: { lf: 325, cf: 399, rf: 320 },
  32: { lf: 344, cf: 400, rf: 345 },
  680: { lf: 331, cf: 401, rf: 326 },
  2392: { lf: 315, cf: 409, rf: 326 },
  2394: { lf: 345, cf: 420, rf: 330 },
  2395: { lf: 339, cf: 399, rf: 309 },
  2529: { lf: 330, cf: 400, rf: 325 },
  2602: { lf: 328, cf: 404, rf: 325 },
  2680: { lf: 336, cf: 396, rf: 322 },
  2681: { lf: 329, cf: 401, rf: 330 },
  2889: { lf: 336, cf: 400, rf: 335 },
  3289: { lf: 335, cf: 408, rf: 330 },
  3309: { lf: 337, cf: 402, rf: 335 },
  3312: { lf: 339, cf: 411, rf: 328 },
  3313: { lf: 318, cf: 408, rf: 314 },
  4169: { lf: 344, cf: 407, rf: 335 },
  4705: { lf: 335, cf: 400, rf: 325 },
  5325: { lf: 329, cf: 407, rf: 326 },
};

export type AirShot = {
  dist: number;
  spray: number | null;
  ev: number;
  la: number;
  hr: boolean;
};

export function fenceAt(venueId: number, spray: number): number {
  const f = PARK_FENCE[venueId] ?? { lf: 330, cf: 400, rf: 330 };
  const a = Math.max(-45, Math.min(45, spray));
  if (a <= 0) {
    const t = (a + 45) / 45;
    return f.lf + t * (f.cf - f.lf);
  }
  return f.cf + (a / 45) * (f.rf - f.cf);
}

export function shotClearsPark(venueId: number, shot: AirShot): boolean {
  if (shot.hr && shot.dist >= 300) return true;
  if (shot.dist >= 280) {
    const need = fenceAt(venueId, shot.spray ?? 0);
    return shot.dist >= need - 3;
  }
  if (shot.ev >= 102 && shot.la >= 22 && shot.la <= 36) {
    const pullSpray = shot.spray ?? 0;
    const need = fenceAt(venueId, pullSpray);
    return need <= 338 && shot.ev >= 104;
  }
  return false;
}

export function parkTrueCount(venueId: number, shots: AirShot[] | null | undefined): { n: number; of: number } {
  if (!shots || shots.length === 0) return { n: 0, of: 0 };
  const usable = shots.filter((s) => s.dist >= 250 || s.hr || (s.ev >= 100 && s.la >= 18));
  const n = usable.filter((s) => shotClearsPark(venueId, s)).length;
  return { n, of: usable.length };
}

export function windSprayMatch(
  windStr: string | null | undefined,
  bats: string | undefined,
  pullPct: number | null | undefined,
  venueId: number,
  condition: string | null | undefined,
): { kind: "pull-out" | "pull-in" | "oppo-out" | "none"; line: string } {
  if (roofClosed(venueId, condition)) {
    return { kind: "none", line: "Roof closed — wind is off." };
  }
  const wind = parseWind(windStr);
  if (wind.mph < 6 || wind.dir === "none") {
    return { kind: "none", line: wind.mph ? `${wind.mph} mph, no pull-side tell` : "No wind posted" };
  }
  const pull = bats === "L" ? "RF" : bats === "R" ? "LF" : "CF";
  const toPull = wind.field === pull || (wind.field === "unk" && wind.dir === "out");
  const pullHitter = pullPct != null && pullPct >= 40;
  const oppo = pullPct != null && pullPct < 33;
  const field = wind.field === "unk" ? "" : `${wind.field} `;
  const way = wind.dir === "out" ? "out" : wind.dir === "in" ? "in" : "cross";
  const bit = `${way} ${field}${wind.mph} mph`;
  if (wind.dir === "out" && toPull && pullHitter) {
    return { kind: "pull-out", line: `${bit} — pull-side out, and he pulls ${pullPct!.toFixed(0)}%` };
  }
  if (wind.dir === "in" && toPull && pullHitter) {
    return { kind: "pull-in", line: `${bit} — in from the pull side. Carry dies.` };
  }
  if (wind.dir === "out" && toPull && oppo) {
    return { kind: "oppo-out", line: `${bit} to the pull side, but spray is oppo (${pullPct!.toFixed(0)}% pull)` };
  }
  return { kind: "none", line: bit };
}
