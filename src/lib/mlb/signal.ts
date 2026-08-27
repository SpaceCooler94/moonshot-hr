import type { HrCheck, HrSignal, KeyPitchMatch, PitchMixRow, PlayerPrediction } from "./types";

/** Public research bars. League barrels sit ~7%; 12% is the power cut. */
export const BARREL_CUT = 12;
export const XISO_CUT = 0.2;
export const PITCH_BRL_CUT = 12;
export const PITCH_USAGE_CUT = 0.1;
export const PITCH_N_CUT = 4;
export const PARK_AIR_CUT = 108;
export const PITCHER_AIR_CUT = 1.1;
export const PLATOON_CUT = 1.05;
export const ORDER_CUT = 4;
export const FORM_BARREL_CUT = 14;
export const FORM_PULL_AIR_CUT = 18;
export const FORM_TANK_CUT = 3;

export function buildHrSignal(p: PlayerPrediction): HrSignal {
  const s = p.statcast;
  const w = p.week;
  const keyMatch = findKeyMatch(p);
  const weekBarrel = w && w.bbe >= 10 ? w.barrelPct : null;
  const formHot =
    (weekBarrel != null && weekBarrel >= FORM_BARREL_CUT) ||
    (w?.tanks ?? 0) >= FORM_TANK_CUT ||
    w?.tanksLast1 === true ||
    w?.ev100Last1 === true ||
    (w?.pullAirPct != null && w.pullAirPct >= FORM_PULL_AIR_CUT && (w.pullPct ?? 0) >= 40);
  const barrelPass = (s?.barrel ?? 0) >= BARREL_CUT;
  const mixHit = !!keyMatch?.loud;
  const formRef = formValue(w, weekBarrel, formHot);

  const checks: HrCheck[] = [
    {
      key: "barrel",
      label: "Barrels",
      pass: barrelPass,
      weight: 2,
      value: s?.barrel ?? null,
      cut: BARREL_CUT,
      unit: "%",
      detail:
        s?.barrel != null
          ? `${s.barrel.toFixed(1)}% season (${BARREL_CUT}% cut)`
          : "No Statcast",
    },
    {
      key: "xiso",
      label: "xISO",
      pass: (s?.xIso ?? 0) >= XISO_CUT,
      weight: 1,
      value: s?.xIso ?? null,
      cut: XISO_CUT,
      unit: "",
      detail: s?.xIso != null ? `${s.xIso.toFixed(3)} (.${String(Math.round(XISO_CUT * 1000)).padStart(3, "0")} cut)` : "—",
    },
    {
      key: "pitch",
      label: "Pitch match",
      pass: mixHit,
      weight: 2,
      value: keyMatch?.barrelPct ?? null,
      cut: PITCH_BRL_CUT,
      unit: "%",
      detail: pitchDetail(keyMatch, p),
    },
    {
      key: "platoon",
      label: "Platoon",
      pass: p.factors.platoon.value >= PLATOON_CUT,
      weight: 1,
      value: p.factors.platoon.value,
      cut: PLATOON_CUT,
      unit: "×",
      detail: p.factors.platoon.label,
    },
    {
      key: "park",
      label: "Park air",
      pass: p.park.airIndex >= PARK_AIR_CUT,
      weight: 1,
      value: p.park.airIndex,
      cut: PARK_AIR_CUT,
      unit: " air",
      detail: p.park.airLabel,
    },
    {
      key: "pitcher",
      label: "Pitcher air",
      pass: p.factors.pitcher.value >= PITCHER_AIR_CUT,
      weight: 1,
      value: p.factors.pitcher.value,
      cut: PITCHER_AIR_CUT,
      unit: "×",
      detail: p.factors.pitcher.label,
    },
    {
      key: "form",
      label: "Form",
      pass: formHot,
      weight: 1,
      value: formRef.value,
      cut: formRef.cut,
      unit: formRef.unit,
      detail: formLine(p),
    },
    {
      key: "order",
      label: "Order",
      pass: p.battingOrder <= ORDER_CUT,
      weight: 1,
      value: p.battingOrder,
      cut: ORDER_CUT,
      unit: "",
      detail: `#${p.battingOrder} · ${p.expectedPa.toFixed(1)} PA vs SP`,
    },
  ];

  const score = checks.reduce((n, c) => n + (c.pass ? c.weight : 0), 0);
  const passed = checks.filter((c) => c.pass).length;
  const grade: HrSignal["grade"] =
    score >= 7 ? "loud" : score >= 5 ? "live" : score >= 3 ? "thin" : "fade";
  const hits = checks.filter((c) => c.pass);
  const misses = checks.filter((c) => !c.pass);
  const headline = writeHeadline(hits, keyMatch);
  const why = writeWhy(p, grade, keyMatch, hits, misses);
  const missing = misses.length === 0 ? null : missLine(misses[0], keyMatch);

  return { grade, passed, total: checks.length, score, headline, why, missing, keyMatch, checks };
}

export function findKeyMatch(p: PlayerPrediction): KeyPitchMatch | null {
  const mx = p.pitchMatrix;
  if (!mx || mx.pitcher.length === 0) return null;
  let best: { score: number; match: KeyPitchMatch } | null = null;
  for (const pit of mx.pitcher) {
    if (pit.pct < 0.08) continue;
    const hit = mx.hitter.find((r) => r.code === pit.code) ?? null;
    const match = toMatch(pit, hit);
    const damage =
      match.barrelPct != null && match.n >= PITCH_N_CUT
        ? match.barrelPct / 100
        : match.iso != null && match.n >= PITCH_N_CUT
          ? match.iso
          : 0.07;
    const score = pit.pct * (0.35 + damage * 5) + (match.loud ? 0.4 : 0);
    if (!best || score > best.score) best = { score, match };
  }
  return best?.match ?? null;
}

function toMatch(pit: PitchMixRow, hit: PitchMixRow | null): KeyPitchMatch {
  const n = hit?.n ?? 0;
  const barrelPct = hit?.barrelPct ?? null;
  const loud =
    n >= PITCH_N_CUT &&
    pit.pct >= PITCH_USAGE_CUT &&
    ((barrelPct != null && barrelPct >= PITCH_BRL_CUT) || (hit?.iso != null && hit.iso >= 0.2));
  return {
    code: pit.code,
    name: pit.name,
    usage: pit.pct,
    n,
    barrelPct,
    ev: hit?.ev ?? null,
    iso: hit?.iso ?? null,
    hr: hit?.hr ?? 0,
    loud,
  };
}

function formValue(
  w: PlayerPrediction["week"],
  weekBarrel: number | null,
  formHot: boolean,
): { value: number | null; cut: number | null; unit: string } {
  if (w && w.tanks >= 1 && (w.tanks >= FORM_TANK_CUT || w.tanksLast1)) {
    return { value: w.tanks, cut: FORM_TANK_CUT, unit: "" };
  }
  if (weekBarrel != null && weekBarrel >= FORM_BARREL_CUT) {
    return { value: weekBarrel, cut: FORM_BARREL_CUT, unit: "%" };
  }
  if (formHot && w?.ev100Last1 && w.maxEvLast1 != null) {
    return { value: w.maxEvLast1, cut: 100, unit: "" };
  }
  if (formHot && w?.pullAirPct != null && w.pullAirPct >= FORM_PULL_AIR_CUT) {
    return { value: w.pullAirPct, cut: FORM_PULL_AIR_CUT, unit: "%" };
  }
  return { value: weekBarrel, cut: FORM_BARREL_CUT, unit: "%" };
}

function pitchDetail(m: KeyPitchMatch | null, p: PlayerPrediction): string {
  if (!m) return p.pitcher ? "No mix sample" : "SP TBD";
  const usage = `${Math.round(m.usage * 100)}%`;
  if (m.n < PITCH_N_CUT || m.barrelPct == null) {
    return `${m.name} ${usage} mix · no ${PITCH_BRL_CUT}% barrel sample`;
  }
  if (m.loud) {
    return `${m.name} ${m.barrelPct.toFixed(0)}% BRL · he throws ${usage}`;
  }
  return `${m.name} ${usage} mix · ${m.barrelPct.toFixed(0)}% BRL (${PITCH_BRL_CUT}% cut)`;
}

function formLine(p: PlayerPrediction): string {
  const w = p.week;
  if (!w || w.bbe < 1) {
    return p.recent ? `${p.recent.hr} HR last ${p.recent.games}` : "Quiet week";
  }
  const bits: string[] = [];
  if ((w.tanks ?? 0) >= 1) {
    bits.push(`${w.tanks} tank${w.tanks === 1 ? "" : "s"} last 10`);
    if (w.tanksLast1) bits.push("one last game");
  }
  if (w.barrelPct >= 12) bits.push(`${w.barrelPct.toFixed(0)}% barrels last 10`);
  if (w.ev100Last1 && w.maxEvLast1 != null) bits.push(`${w.maxEvLast1.toFixed(0)} last game`);
  else if (w.n100Last3 >= 3) bits.push(`${w.n100Last3}× 100+ last 3`);
  if (w.pullAirPct != null && w.pullAirPct >= FORM_PULL_AIR_CUT) {
    bits.push(`${w.pullAirPct.toFixed(0)}% pull air`);
  }
  return bits.join(" · ") || `${w.barrelPct.toFixed(0)}% barrels last 10`;
}

function writeHeadline(hits: HrCheck[], key: KeyPitchMatch | null): string {
  const bits: string[] = [];
  if (key?.loud && key.barrelPct != null) {
    bits.push(`${key.name} ${key.barrelPct.toFixed(0)}% BRL`);
    bits.push(`he throws ${Math.round(key.usage * 100)}%`);
  }
  for (const c of hits) {
    if (c.key === "pitch" && key?.loud) continue;
    const bit = headlineBit(c, key);
    if (bit && !bits.includes(bit)) bits.push(bit);
    if (bits.length >= 3) break;
  }
  return bits.length === 0 ? "No research bar is lit." : bits.join(" · ");
}

function writeWhy(
  p: PlayerPrediction,
  grade: HrSignal["grade"],
  key: KeyPitchMatch | null,
  hits: HrCheck[],
  misses: HrCheck[],
): string {
  const vs = p.pitcher ? ` vs ${lastWord(p.pitcher.name)}` : "";
  if (grade === "fade") return `${p.lastName || p.name}${vs}: no research bar is lit.`;

  const gradeWord = grade === "loud" ? "Loud" : grade === "live" ? "Live" : "Thin";
  let lead: string;
  if (key?.loud && key.barrelPct != null) {
    const arm = p.pitcher ? lastWord(p.pitcher.name) : "the starter";
    lead = `barrels ${key.name} at ${key.barrelPct.toFixed(0)}% and ${arm} throws it ${Math.round(key.usage * 100)}%`;
  } else {
    const first = hits.find((c) => c.key !== "pitch") ?? hits[0];
    lead = first ? headlineBit(first, key) : "a few bars are on";
  }

  const also = hits
    .filter((c) => !(key?.loud && c.key === "pitch"))
    .slice(key?.loud ? 0 : 1, key?.loud ? 3 : 4)
    .map((c) => headlineBit(c, key))
    .filter(Boolean);

  const gap =
    key && !key.loud && misses.some((m) => m.key === "pitch")
      ? ` The mix gap: ${key.name} is ${Math.round(key.usage * 100)}% of the card and ${p.lastName || "he"} has ${key.barrelPct == null ? "no" : `${key.barrelPct.toFixed(0)}%`} barrels on it (${PITCH_BRL_CUT}% cut).`
      : misses[0] && grade !== "loud"
        ? ` Missing ${misses[0].label.toLowerCase()}.`
        : "";

  const alsoBit = also.length ? `. Also ${also.join(" · ")}` : "";
  return `${gradeWord} HR look — ${lead}${alsoBit}.${gap}`;
}

function missLine(miss: HrCheck, key: KeyPitchMatch | null): string {
  if (miss.key === "pitch" && key) {
    const brl = key.barrelPct == null ? "no sample" : `${key.barrelPct.toFixed(0)}% BRL`;
    return `${key.name} ${Math.round(key.usage * 100)}% mix · ${brl}`;
  }
  return miss.detail.split(" · ")[0];
}

function headlineBit(c: HrCheck, key: KeyPitchMatch | null): string {
  if (c.key === "pitch") {
    if (key?.loud && key.barrelPct != null) return `${key.name} ${key.barrelPct.toFixed(0)}% BRL`;
    const m = /(\S+)\s+(\d+)%/.exec(c.detail);
    return m ? `${m[1]} ${m[2]}% barrels` : c.detail.split(" · ")[0];
  }
  if (c.key === "barrel") {
    const n = c.detail.match(/[\d.]+/);
    return n ? `${n[0]}% barrels` : "barrels";
  }
  if (c.key === "park") {
    const air = c.detail.match(/(\d+)\s*air/i);
    return air ? `${air[1]} air` : c.detail.split(" · ")[0];
  }
  if (c.key === "platoon") return "platoon";
  if (c.key === "form") return c.detail.split(" · ")[0];
  if (c.key === "order") return c.detail;
  if (c.key === "xiso") return `xISO ${c.detail.split(" ")[0]}`;
  if (c.key === "pitcher") return "air starter";
  return c.label;
}

function lastWord(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}
