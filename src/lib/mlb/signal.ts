import type { HrCheck, HrSignal, KeyPitchMatch, PitchMixRow, PlayerPrediction } from "./types";
import { studyBvp } from "./bvp";

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
export const SWEET_CUT = 35;
export const EV_CUT = 91;
export const FLY_CUT = 26;
export const BAT_CUT = 75;
export const PITCHER_K_CUT = 20;
export const TREND_CUT = 3;
export const HARD_BARREL_CUT = 2;
export const HEART_CUT = 12;

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
    (w?.brl105 ?? 0) >= HARD_BARREL_CUT ||
    (w?.pullAirPct != null && w.pullAirPct >= FORM_PULL_AIR_CUT && (w.pullPct ?? 0) >= 40) ||
    w?.trendUp === true;
  const barrelPass = (s?.barrel ?? 0) >= BARREL_CUT;
  const mixHit = !!keyMatch?.loud;
  const formRef = formValue(w, weekBarrel, formHot);

  const kPct = p.pitcher?.kPct ?? null;
  const sweet = s?.sweetSpot ?? null;
  const ev = s?.ev ?? null;
  const fly = s?.flyBall ?? null;
  const bat = s?.swingSpeed ?? null;
  const hard = s?.hardHit ?? null;
  const tanks = w?.tanks ?? 0;
  const tankPass = tanks >= FORM_TANK_CUT || w?.tanksLast1 === true;
  const pullAir = pullAirRef(p);
  const trendBar = trendValueOf(w);

  const checks: HrCheck[] = [
    {
      key: "barrel",
      label: "Barrels",
      pass: barrelPass,
      weight: 2,
      value: s?.barrel ?? null,
      cut: BARREL_CUT,
      unit: "%",
      group: "profile",
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
      group: "profile",
      detail: s?.xIso != null ? `${s.xIso.toFixed(3)} (.${String(Math.round(XISO_CUT * 1000)).padStart(3, "0")} cut)` : "—",
    },
    {
      key: "sweet",
      label: "Sweet-spot",
      pass: (sweet ?? 0) >= SWEET_CUT,
      weight: 1,
      value: sweet,
      cut: SWEET_CUT,
      unit: "%",
      group: "profile",
      detail:
        sweet != null
          ? `${sweet.toFixed(1)}% of BBE in 8–32° (${SWEET_CUT}% cut)`
          : "No sweet-spot",
    },
    {
      key: "ev",
      label: "Exit velo",
      pass: (ev ?? 0) >= EV_CUT,
      weight: 1,
      value: ev,
      cut: EV_CUT,
      unit: " mph",
      group: "profile",
      detail:
        ev != null
          ? `${ev.toFixed(1)} mph avg${hard != null ? ` · ${hard.toFixed(0)}% hard` : ""} (${EV_CUT} cut)`
          : "No EV",
    },
    {
      key: "fly",
      label: "Fly ball",
      pass: (fly ?? 0) >= FLY_CUT,
      weight: 1,
      value: fly,
      cut: FLY_CUT,
      unit: "%",
      group: "profile",
      detail: fly != null ? `${fly.toFixed(1)}% fly (${FLY_CUT}% cut)` : "No fly-ball rate",
    },
    {
      key: "bat",
      label: "Bat speed",
      pass: (bat ?? 0) >= BAT_CUT,
      weight: 1,
      value: bat,
      cut: BAT_CUT,
      unit: " mph",
      group: "profile",
      detail: bat != null ? `${bat.toFixed(1)} mph swing (${BAT_CUT} cut)` : "No bat speed",
    },
    {
      key: "pitch",
      label: "Pitch match",
      pass: mixHit,
      weight: 2,
      value: keyMatch?.barrelPct ?? null,
      cut: PITCH_BRL_CUT,
      unit: "%",
      group: "tonight",
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
      group: "tonight",
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
      group: "tonight",
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
      group: "tonight",
      detail: p.factors.pitcher.label,
    },
    {
      key: "pitcherK",
      label: "Arm K%",
      pass: kPct != null && kPct <= PITCHER_K_CUT,
      weight: 1,
      value: kPct,
      cut: PITCHER_K_CUT,
      unit: "%",
      invert: true,
      group: "tonight",
      detail:
        kPct != null
          ? `${kPct.toFixed(1)}% K on the starter (≤${PITCHER_K_CUT}% is the hole)`
          : p.pitcher
            ? "No K% on the card"
            : "SP TBD",
    },
    {
      key: "tanks",
      label: "Tanks",
      pass: tankPass,
      weight: 1,
      value: tanks,
      cut: FORM_TANK_CUT,
      unit: "",
      group: "tonight",
      detail: tankLine(w),
    },
    {
      key: "pullAir",
      label: "Pull air",
      pass: pullAir.pass,
      weight: 1,
      value: pullAir.value,
      cut: pullAir.cut,
      unit: "%",
      group: "tonight",
      detail: pullAir.detail,
    },
    {
      key: "trend",
      label: "Trend",
      pass: w?.trendUp === true,
      weight: 1,
      value: trendBar.value,
      cut: trendBar.cut,
      unit: trendBar.unit,
      group: "tonight",
      detail: w?.trendDetail ?? "No last-10 sample",
    },
    {
      key: "hardBarrel",
      label: "105+ barrels",
      pass: (w?.brl105 ?? 0) >= HARD_BARREL_CUT,
      weight: 1,
      value: w?.brl105 ?? null,
      cut: HARD_BARREL_CUT,
      unit: "",
      group: "tonight",
      detail: hardBarrelLine(w),
    },
    {
      key: "heart",
      label: "Heart / zone",
      pass: heartPass(w, p.pitcher),
      weight: 1,
      value: heartValue(w, p.pitcher),
      cut: HEART_CUT,
      unit: "%",
      group: "tonight",
      detail: heartLine(w, p.pitcher),
    },
    {
      key: "form",
      label: "Form",
      pass: formHot,
      weight: 1,
      value: formRef.value,
      cut: formRef.cut,
      unit: formRef.unit,
      group: "tonight",
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
      invert: true,
      group: "tonight",
      detail: `#${p.battingOrder} · ${p.expectedPa.toFixed(1)} PA vs SP`,
    },
  ];

  const score = checks.reduce((n, c) => n + (c.pass ? c.weight : 0), 0);
  const passed = checks.filter((c) => c.pass).length;
  const grade: HrSignal["grade"] =
    score >= 11 ? "loud" : score >= 8 ? "live" : score >= 5 ? "thin" : "fade";
  const hits = checks.filter((c) => c.pass);
  const misses = checks.filter((c) => !c.pass);
  const headline = writeHeadline(hits, keyMatch);
  const why = writeWhy(p, grade, keyMatch, hits, misses);
  const missing = misses.length === 0 ? null : missLine(misses[0], keyMatch);
  const decision = buildDecision(p, checks, grade, keyMatch);

  return { grade, passed, total: checks.length, score, headline, why, missing, keyMatch, checks, decision };
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
    const score =
      pit.pct * (0.35 + damage * 5) + (match.loud ? 0.4 : 0) + (match.both20 ? 1.5 : 0);
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
  const pitBarrelPct = pit.barrelPct;
  const both20 =
    n >= 6 &&
    pit.n >= 8 &&
    pit.pct >= 0.15 &&
    pitBarrelPct != null &&
    pitBarrelPct >= 18 &&
    barrelPct != null &&
    barrelPct >= 18;
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
    pitBarrelPct,
    pitN: pit.n,
    both20,
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

function tankLine(w: PlayerPrediction["week"]): string {
  if (!w || w.bbe < 1) return "No batted balls last 10";
  const bits = [`${w.tanks} tank${w.tanks === 1 ? "" : "s"} last 10 (102+ · 20–38° · pulled)`];
  if (w.tanksLast1) bits.push("one last game");
  else if (w.tanksLast3 > 0) bits.push(`${w.tanksLast3} in last 3`);
  return bits.join(" · ");
}

function hardBarrelLine(w: PlayerPrediction["week"]): string {
  if (!w || w.bbe < 1) return "No batted balls last 10";
  const mean = w.barrelEv != null ? ` · ${w.barrelEv.toFixed(0)} mph mean barrel` : "";
  return `${w.brl98} at 98–101 · ${w.brl102} at 102–104 · ${w.brl105} at 105+${mean}`;
}

function heartPass(w: PlayerPrediction["week"], pit: PlayerPrediction["pitcher"]): boolean {
  const pct = w?.heart?.pct;
  const n = w?.heart?.bbe ?? 0;
  if (pct != null && n >= 8 && pct >= HEART_CUT) return true;
  if (pit?.inZone != null && pit.inZone >= 52 && pct != null && n >= 6 && pct >= 10) return true;
  return false;
}

function heartValue(w: PlayerPrediction["week"], pit: PlayerPrediction["pitcher"]): number | null {
  if (w?.heart?.pct != null) return w.heart.pct;
  return pit?.inZone ?? null;
}

function heartLine(w: PlayerPrediction["week"], pit: PlayerPrediction["pitcher"]): string {
  const bits: string[] = [];
  if (w?.heart && w.heart.bbe > 0) {
    bits.push(`heart ${w.heart.pct != null ? `${w.heart.pct.toFixed(0)}% BRL` : "—"} (${w.heart.bbe} BBE)`);
  }
  if (w?.shadow && w.shadow.bbe > 0) {
    bits.push(`shadow ${w.shadow.pct != null ? `${w.shadow.pct.toFixed(0)}%` : "—"}`);
  }
  if (w?.chase && w.chase.bbe > 0) {
    bits.push(`chase ${w.chase.pct != null ? `${w.chase.pct.toFixed(0)}%` : "—"}`);
  }
  if (pit?.inZone != null) bits.push(`arm ${pit.inZone.toFixed(0)}% in-zone`);
  if (pit?.edge != null) bits.push(`${pit.edge.toFixed(0)}% edge`);
  return bits.join(" · ") || "No zone sample";
}

function pullAirRef(p: PlayerPrediction): { pass: boolean; value: number | null; cut: number; detail: string } {
  const w = p.week;
  if (w?.pullAirPct != null && w.pullPct != null) {
    return {
      pass: w.pullPct >= 40 && w.pullAirPct >= FORM_PULL_AIR_CUT,
      value: w.pullAirPct,
      cut: FORM_PULL_AIR_CUT,
      detail: `${w.pullPct.toFixed(0)}% pull · ${w.pullAirPct.toFixed(0)}% pull air last 10`,
    };
  }
  const pull = p.statcast?.pull;
  const fly = p.statcast?.flyBall;
  if (pull != null && fly != null) {
    return {
      pass: pull >= 40 && fly >= FLY_CUT,
      value: fly,
      cut: FLY_CUT,
      detail: `${pull.toFixed(0)}% pull · ${fly.toFixed(0)}% fly season`,
    };
  }
  return { pass: false, value: null, cut: FORM_PULL_AIR_CUT, detail: "No spray sample" };
}

function trendValueOf(w: PlayerPrediction["week"]): { value: number | null; cut: number; unit: string } {
  if (!w) return { value: null, cut: TREND_CUT, unit: "" };
  if (w.barrelDelta != null && w.barrelDelta >= TREND_CUT) {
    return { value: w.barrelDelta, cut: TREND_CUT, unit: "" };
  }
  if (w.last3vs10 != null && w.last3vs10 >= 4) {
    return { value: w.last3vs10, cut: 4, unit: "" };
  }
  if (w.evDelta != null && w.evDelta >= 1.5) {
    return { value: w.evDelta, cut: 1.5, unit: "" };
  }
  return { value: w.barrelDelta, cut: TREND_CUT, unit: "" };
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
  if (c.key === "tanks") return c.detail.split(" · ")[0];
  if (c.key === "trend") return c.detail.split(" · ")[0];
  if (c.key === "pullAir") return c.detail.split(" · ")[0];
  if (c.key === "order") return c.detail;
  if (c.key === "xiso") return `xISO ${c.detail.split(" ")[0]}`;
  if (c.key === "pitcher") return "air starter";
  if (c.key === "pitcherK") return c.value != null ? `${c.value.toFixed(0)}% K` : "arm K%";
  if (c.key === "sweet") return c.value != null ? `${c.value.toFixed(0)}% sweet` : "sweet-spot";
  if (c.key === "ev") return c.value != null ? `${c.value.toFixed(0)} EV` : "EV";
  if (c.key === "fly") return c.value != null ? `${c.value.toFixed(0)}% fly` : "fly ball";
  if (c.key === "bat") return c.value != null ? `${c.value.toFixed(0)} bat` : "bat speed";
  if (c.key === "hardBarrel") return c.value != null ? `${c.value}× 105+` : "105+ barrels";
  if (c.key === "heart") return c.value != null ? `${c.value.toFixed(0)}% heart` : "heart / zone";
  return c.label;
}

function lastWord(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}

function onCheck(checks: HrCheck[], key: string): boolean {
  return checks.find((c) => c.key === key)?.pass === true;
}

function buildDecision(
  p: PlayerPrediction,
  checks: HrCheck[],
  grade: HrSignal["grade"],
  key: KeyPitchMatch | null,
): HrSignal["decision"] {
  const mix = onCheck(checks, "pitch") || !!key?.loud;
  const tanks = onCheck(checks, "tanks");
  const trend = onCheck(checks, "trend");
  const form = onCheck(checks, "form");
  const heat = tanks || trend || form;
  const barrel = onCheck(checks, "barrel");
  const ev = onCheck(checks, "ev");
  const xiso = onCheck(checks, "xiso");
  const fly = onCheck(checks, "fly");
  const profile = barrel || (ev && fly) || (xiso && ev);
  const live = grade === "loud" || grade === "live";
  const order = onCheck(checks, "order");
  const cooled = p.week?.cooled === true;
  const softened = p.week?.softened === true;
  const dead = cooled || softened;
  const pass = mix && heat && profile && live && order && !dead;
  const tags: string[] = [];
  if (mix && key?.name) tags.push(key.name);
  else if (mix) tags.push("Mix");
  if (tanks) tags.push("Tanks");
  if (trend) tags.push("Trend");
  if (form && !tanks && !trend) tags.push("Form");
  if (barrel) tags.push("Barrels");
  else if (ev) tags.push("EV");
  if (p.week?.parkTrue && p.week.parkTrue >= 3) tags.push("Park-true");
  if (p.week?.windKind === "pull-out") tags.push("Pull-out");
  if (p.week?.qualityAhead) tags.push("Ahead");
  if (key?.both20) tags.push("20×20");
  const missing = dead
    ? cooled
      ? "cooled bat speed"
      : "softened airborne"
    : !mix
      ? "mix"
      : !heat
        ? "heat (trend / tanks / form)"
        : !profile
          ? "profile (barrels / EV)"
          : !live
            ? "grade"
            : !order
              ? "order (1–4)"
              : null;
  const score =
    (mix ? 4 : 0) +
    (tanks ? 2 : 0) +
    (trend ? 2 : 0) +
    (form ? 1 : 0) +
    (barrel ? 1 : 0) +
    (ev ? 1 : 0) +
    (order ? 1 : 0);
  const { push, line, tonight } = tonightPush(p, checks, key);
  const bvp = studyBvp({ ...p, signal: { ...p.signal, keyMatch: key, checks } });
  if (bvp.grade === "best" && !tags.includes("BvP")) tags.push("BvP");
  if (bvp.mixHr >= 2) tags.push(`${bvp.mixHr} mix HR`);
  return {
    pass,
    score,
    tags,
    missing,
    push,
    line,
    tonight,
    bvp: bvp.score,
    bvpGrade: bvp.grade,
    bvpLine: bvp.line,
    bvpLayers: bvp.layers,
    both20: bvp.both20,
    mixHr: bvp.mixHr,
  };
}

function tonightPush(
  p: PlayerPrediction,
  checks: HrCheck[],
  key: KeyPitchMatch | null,
): { push: number; line: string; tonight: string[] } {
  const w = p.week;
  let pts = 0;
  const tonight: string[] = [];
  const arm = p.pitcher ? lastWord(p.pitcher.name) : "the starter";

  if (key?.loud) {
    pts += 28;
    if (key.both20) pts += 18;
    else if (key.barrelPct != null && key.barrelPct >= 20) pts += 10;
    else if (key.barrelPct != null && key.barrelPct >= 16) pts += 5;
    if (key.usage >= 0.28) pts += 8;
    else if (key.usage >= 0.2) pts += 4;
    if (key.n >= 8) pts += 3;
    const brl = key.barrelPct != null ? `${key.barrelPct.toFixed(0)}% BRL` : `${key.iso?.toFixed(2)} ISO`;
    tonight.push(`${key.name} ${brl} · ${Math.round(key.usage * 100)}% mix`);
  }

  if (w?.tanksLast1) {
    pts += 16;
    tonight.push("tank last game");
  } else if ((w?.tanksLast3 ?? 0) >= 2) {
    pts += 10;
    tonight.push(`${w!.tanksLast3} tanks last 3`);
  } else if ((w?.tanks ?? 0) >= FORM_TANK_CUT) {
    pts += 7;
    tonight.push(`${w!.tanks} tanks last 10`);
  }

  if (w?.last3vs10 != null && w.last3vs10 >= 4) {
    pts += 14;
    tonight.push(`+${Math.round(w.last3vs10)} brl last 3`);
  } else if (w?.barrelDelta != null && w.barrelDelta >= TREND_CUT) {
    pts += 6;
    tonight.push(`+${w.barrelDelta.toFixed(0)} brl vs season`);
  }

  if (!w?.tanksLast1 && w?.ev100Last1 && w.maxEvLast1 != null) {
    pts += 8;
    tonight.push(`${w.maxEvLast1.toFixed(0)} last game`);
  }

  if ((w?.brl105 ?? 0) >= HARD_BARREL_CUT) {
    pts += 10;
    tonight.push(`${w!.brl105}× 105+ barrels`);
  } else if ((w?.brl102 ?? 0) + (w?.brl105 ?? 0) >= 3) {
    pts += 5;
    tonight.push(`${(w!.brl102 ?? 0) + (w!.brl105 ?? 0)} barrels 102+`);
  }

  if (onCheck(checks, "heart")) {
    pts += 6;
    tonight.push("heart / zone");
  }

  if (onCheck(checks, "form") && !w?.tanksLast1) {
    pts += 5;
    tonight.push("week form");
  }

  if (p.battingOrder <= 2) {
    pts += 10;
    tonight.push(`#${p.battingOrder}`);
  } else if (p.battingOrder <= 4) {
    pts += 5;
  }

  if (onCheck(checks, "platoon")) pts += 6;
  if (onCheck(checks, "park")) pts += 5;
  if (onCheck(checks, "pitcher")) pts += 4;
  if (onCheck(checks, "pitcherK")) pts += 4;

  if ((w?.parkTrue ?? 0) >= 3) {
    pts += 10;
    tonight.push(`${w!.parkTrue}/${w!.parkTrueOf} would be HR here`);
  }
  if (w?.windKind === "pull-out") {
    pts += 8;
    tonight.push("pull-side wind out");
  } else if (w?.windKind === "pull-in") {
    pts -= 8;
    tonight.push("wind in from pull");
  } else if (w?.windKind === "oppo-out") {
    pts -= 4;
    tonight.push("wind out, spray oppo");
  }
  if (w?.qualityAhead) {
    pts += 7;
    tonight.push("quality ahead of the box");
  }
  if (w?.airborneUp) {
    pts += 6;
    tonight.push("airborne getting louder");
  }
  if (w?.cooled) pts -= 12;
  if (w?.softened) pts -= 10;

  let line: string;
  if (key?.loud && key.barrelPct != null) {
    line = `Today: barrels ${arm}'s ${key.name} at ${key.barrelPct.toFixed(0)}% (${Math.round(key.usage * 100)}% of the card)`;
    const extra = tonight.filter((t) => !t.startsWith(key.name)).slice(0, 2);
    if (extra.length) line += ` · ${extra.join(" · ")}`;
  } else if (tonight.length) {
    line = `Today: ${tonight.slice(0, 3).join(" · ")}`;
  } else {
    line = "Clears the checklist, no extra tonight heat.";
  }

  return { push: Math.min(100, pts), line, tonight: tonight.slice(0, 5) };
}
