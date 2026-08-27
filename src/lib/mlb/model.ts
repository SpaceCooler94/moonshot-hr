import { dailyParkAir, sprayPark } from "./parks";
import type { SavantBatter, SavantLeague, SavantPitcher, SideContact, WeekContact } from "./savant";
import { barrelPct, ev100Flags, pitchFamily, tankFlags, weekShape } from "./savant";
import type { ArsenalPitch, ConfidenceBand, Factor, LineupSource, MixFamily, PitchMixRow } from "./types";

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
/** League starter workload. ~6 IP, ~23 TBF. */
export const LEAGUE_TBF_PER_START = 22.8;
/** Share of 1–9 hitters who go yard vs the starter (not the bullpen). */
export const STARTER_HR_RATE = 0.077;
/** Compress stacked multipliers so a loud card cannot run away from the base rate. */
export const DAMPING = 0.62;
/** Monday 8/24: 16%+ printed 18–22% and hit 8% / 0%. Pull the excess back. Ranking is unchanged. */
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

/** Shrink a starter's batters-faced per outing toward league ~23. */
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

/** Expected PA vs this starter. Remainder of the TBF goes to early slots (times through). */
export function paVsStarter(order: number, tbf: number): number {
  const slot = Math.min(9, Math.max(1, Math.round(order)));
  const base = Math.floor(tbf / 9);
  const rem = tbf - base * 9;
  const extra = clamp(rem - (slot - 1), 0, 1);
  return clamp(base + extra, 1.2, 4.2);
}

export function platoonFactor(bats: string, throws: string | null): Factor {
  if (!throws) return { value: 1, label: "Pitcher TBD" };
  const b = bats === "S" ? "S" : bats === "L" ? "L" : "R";
  const t = throws === "L" ? "L" : "R";
  if (b === "S") {
    return t === "R"
      ? { value: 1.03, label: "Switch vs RHP" }
      : { value: 0.97, label: "Switch vs LHP" };
  }
  if (b === t) {
    return { value: 0.9, label: `${b}HB vs ${t}HP · same side` };
  }
  return { value: 1.08, label: `${b}HB vs ${t}HP · platoon` };
}

export function weatherFactor(
  tempStr: string | null | undefined,
  wind: string | null | undefined,
): Factor {
  let factor = 1;
  const bits: string[] = [];
  const temp = Number(tempStr);
  if (Number.isFinite(temp) && temp > 0) {
    factor *= 1 + (temp - 72) * 0.004;
    bits.push(`${Math.round(temp)}°F`);
  }
  const w = wind ?? "";
  const mph = Number(/(\d+)\s*mph/i.exec(w)?.[1] ?? 0);
  const low = w.toLowerCase();
  if (mph >= 5) {
    if (low.includes("out")) {
      factor *= 1 + mph * 0.008;
      bits.push(`wind out ${mph}`);
    } else if (/\bin\b/.test(low)) {
      factor *= 1 - mph * 0.008;
      bits.push(`wind in ${mph}`);
    } else {
      bits.push(`${mph} mph wind`);
    }
  } else if (mph > 0) {
    bits.push(`${mph} mph wind`);
  }
  return {
    value: clamp(factor, 0.82, 1.22),
    label: bits.join(" · ") || "Neutral air",
  };
}

export function pAtLeastOne(pPa: number, pa: number): number {
  const p = clamp(pPa, 0.0004, 0.18);
  return 1 - Math.pow(1 - p, pa);
}

export function confidenceBand(score: number): ConfidenceBand {
  if (score >= 0.74) return "stable";
  if (score >= 0.52) return "fair";
  return "thin";
}

export function mixFamily(
  hardPct: number | null | undefined,
  breakPct: number | null | undefined,
  offPct: number | null | undefined,
): MixFamily | null {
  if (hardPct == null) return null;
  if (hardPct >= 0.48) return "hard";
  if ((breakPct ?? 0) >= (offPct ?? 0)) return "break";
  return "off";
}

export function scoreMatchup(input: {
  batterHr: number;
  batterPa: number;
  recentHr: number | null;
  recentPa: number | null;
  pitcherHr: number | null;
  pitcherBf: number | null;
  bats: string;
  throws: string | null;
  venueId: number;
  temp: string | null;
  wind: string | null;
  order: number;
  leagueHrPa: number;
  leagueHrBf: number;
  lineupSource: LineupSource;
  savant?: SavantBatter | null;
  pitcherSavant?: SavantPitcher | null;
  savantLeague?: SavantLeague | null;
  week?: WeekContact | null;
  vsL?: { hr: number; pa: number } | null;
  vsR?: { hr: number; pa: number } | null;
  pitcherHardPct?: number | null;
  pitcherBreakPct?: number | null;
  pitcherOffPct?: number | null;
  pitcherArsenal?: ArsenalPitch[] | null;
  pitcherKPct?: number | null;
  pitcherGs?: number | null;
  pitcherMatrix?: PitchMixRow[] | null;
  hitterMatrix?: PitchMixRow[] | null;
  yearPark?: number | null;
  condition?: string | null;
  humidity?: number | null;
  dewpoint?: number | null;
}): {
  pHr: number;
  pHrRaw: number;
  xHr: number;
  expectedPa: number;
  pHrPa: number;
  confidence: number;
  confidenceBand: ConfidenceBand;
  confidenceNotes: string[];
  reasons: string[];
  gamePa: number;
  starterTbf: number;
  factors: {
    batter: Factor;
    pitcher: Factor;
    park: Factor;
    platoon: Factor;
    weather: Factor;
    form: Factor;
  };
} {
  const lgHrPa = input.leagueHrPa || 0.031;
  const lgHrBf = input.leagueHrBf || 0.028;
  const lg = input.savantLeague;
  const notes: string[] = [];
  let conf = 1;

  const batterRate = shrinkRate(input.batterHr, input.batterPa, lgHrPa, 140);
  const hrPaMult = clamp(batterRate / lgHrPa, 0.4, 2.35);
  const contact = contactQuality(input.savant, lg);
  const batterMult = contact
    ? clamp(0.35 * hrPaMult + 0.65 * contact.value, 0.4, 2.4)
    : hrPaMult;
  const batter: Factor = {
    value: batterMult,
    label: contact
      ? `${input.batterHr} HR · ${contact.label}`
      : input.batterPa >= 80
        ? `${input.batterHr} HR / ${input.batterPa} PA`
        : input.batterPa > 0
          ? `Small sample · ${input.batterHr} HR / ${input.batterPa} PA`
          : "Regressed to league",
  };
  if (input.batterPa < 80) {
    conf *= 0.55;
    notes.push("Short season sample");
  } else if (input.batterPa < 220) {
    conf *= 0.72 + 0.28 * ((input.batterPa - 80) / 140);
  }
  if (contact) conf = clamp(conf * 1.08, 0, 0.97);
  else conf *= 0.92;

  let pitcher: Factor;
  const bf = input.pitcherBf;
  const air = pitcherAir(input.pitcherSavant, lg);
  const family = mixFamily(input.pitcherHardPct, input.pitcherBreakPct, input.pitcherOffPct);
  const mxMix = matrixMix(input.pitcherMatrix, input.hitterMatrix, lg?.barrel || 7.1);
  const weekMix = pitchMix(
    input.week,
    family,
    input.pitcherHardPct,
    lg?.barrel || 7.1,
    input.pitcherArsenal,
  );
  const mix = mxMix ?? weekMix;
  const zone = zoneFit(input.week, input.pitcherSavant, lg);
  const kPct = input.pitcherKPct ?? input.pitcherSavant?.kPct ?? null;
  const volume = contactVolume(kPct, lg?.kPct || 22.4);
  if (bf != null && input.pitcherHr != null && bf >= 40) {
    const pRate = shrinkRate(input.pitcherHr, bf, lgHrBf, 220);
    const hrBfMult = clamp(pRate / lgHrBf, 0.55, 1.65);
    let blended = air ? clamp(0.5 * hrBfMult + 0.5 * air.value, 0.5, 1.7) : hrBfMult;
    if (mix) blended = clamp(0.65 * blended + 0.35 * mix.value, 0.5, 1.75);
    if (zone) blended = clamp(0.85 * blended + 0.15 * zone.value, 0.5, 1.75);
    if (volume) blended = clamp(0.85 * blended + 0.15 * volume.value, 0.5, 1.75);
    const extra = [mix?.label, zone?.label, volume && volume.value >= 1.05 ? volume.label : null]
      .filter(Boolean)
      .join(" · ");
    const extraBit = extra ? ` · ${extra}` : "";
    pitcher = {
      value: blended,
      label: air
        ? `${input.pitcherHr} HR / ${bf} BF · ${air.label}${extraBit}`
        : `${input.pitcherHr} HR / ${bf} BF${extraBit}`,
    };
    if (bf < 120) {
      conf *= 0.64;
      notes.push("Starter sample thin");
    } else if (bf < 280) {
      conf *= 0.84 + 0.16 * ((bf - 120) / 160);
    }
  } else if (air) {
    let blended = mix ? clamp(0.65 * air.value + 0.35 * mix.value, 0.5, 1.75) : air.value;
    if (zone) blended = clamp(0.85 * blended + 0.15 * zone.value, 0.5, 1.75);
    if (volume) blended = clamp(0.85 * blended + 0.15 * volume.value, 0.5, 1.75);
    const extra = [mix?.label, zone?.label, volume && volume.value >= 1.05 ? volume.label : null]
      .filter(Boolean)
      .join(" · ");
    pitcher = { value: blended, label: extra ? `${air.label} · ${extra}` : air.label };
    conf *= 0.78;
    notes.push("Starter HR sample thin · using Statcast air");
  } else {
    pitcher = { value: 1, label: "Pitcher TBD / thin sample" };
    conf *= 0.6;
    notes.push("No established starter");
  }

  const env = dailyParkAir(
    input.venueId,
    input.bats,
    input.temp,
    input.wind,
    input.condition,
    input.yearPark,
    input.humidity,
    input.dewpoint,
  );
  const spray = sprayPark(
    input.venueId,
    input.bats,
    input.savant?.pull,
    input.savant?.flyBall,
    lg?.pull || 40,
    lg?.flyBall || 25,
  );
  const parkIdx = Math.round(Math.min(142, Math.max(78, env.index + spray.pts)));
  let parkLabel = env.label.replace(/^\d+ air/, `${parkIdx} air`);
  if (spray.label) parkLabel += ` · ${spray.label}`;
  const park: Factor = {
    value: parkIdx / 100,
    label: parkLabel + (input.bats === "S" ? " · switch" : ` · ${input.bats}HB`),
  };

  const platoon = truePlatoon({
    bats: input.bats,
    throws: input.throws,
    vsL: input.vsL,
    vsR: input.vsR,
    week: input.week,
    lgHrPa,
    lgBarrel: lg?.barrel || 7.1,
  });
  const weather = weatherFactor(input.temp, input.wind);
  weather.value = 1;
  weather.label = env.closed ? `${weather.label} · roof closed` : weather.label;
  if (!input.temp) {
    conf *= 0.94;
    notes.push("Weather not posted");
  }

  const form = weekForm(input.week, input.savant, lg?.barrel || 7.1, input.recentHr, input.recentPa, batterRate);
  if (input.week && input.week.bbe >= 10) conf = clamp(conf * 1.06, 0, 0.97);

  const tbf = starterTbf(input.pitcherBf, input.pitcherGs);
  const pa = paVsStarter(input.order, tbf);
  const gamePa = expectedPa(input.order);
  if (input.pitcherGs != null && input.pitcherGs > 0 && input.pitcherGs < 5) {
    conf *= 0.9;
    notes.push("Starter outing length thin");
  }

  if (input.lineupSource === "projected") {
    conf *= 0.72;
    notes.push("Projected order");
  }

  conf = clamp(conf, 0.3, 0.97);

  const rawMult =
    batter.value * pitcher.value * park.value * platoon.value * weather.value * form.value;
  const damped = Math.pow(rawMult, DAMPING);
  const pHrPa = clamp(lgHrPa * damped, 0.003, 0.07);
  const pHrRaw = pAtLeastOne(pHrPa, pa);
  const pHr = publishPHr(pHrRaw, conf);
  const xHr = pa * (1 - Math.pow(1 - pHr, 1 / pa));

  const ev100 = ev100Flags(input.week);
  return {
    pHr,
    pHrRaw,
    xHr,
    expectedPa: pa,
    pHrPa,
    gamePa,
    starterTbf: tbf,
    confidence: conf,
    confidenceBand: confidenceBand(conf),
    confidenceNotes: notes,
    reasons: lookReasons({
      savant: input.savant,
      week: input.week,
      throws: input.throws,
      parkIdx,
      platoon: platoon.value,
      weather,
      pitcherAir: air?.value ?? null,
      mix: mix?.value ?? null,
      mixLabel: mix?.label ?? null,
      zoneLabel: zone && zone.value >= 1.05 ? zone.label : null,
      pitcherKPct: kPct,
      sprayLabel: spray.label,
      order: input.order,
      ev100,
    }),
    factors: { batter, pitcher, park, platoon, weather, form },
  };
}

function contactQuality(
  s: SavantBatter | null | undefined,
  lg: SavantLeague | null | undefined,
): { value: number; label: string } | null {
  if (!s || s.barrel == null || s.pa < 40) return null;
  const lb = lg?.barrel || 7.1;
  const le = lg?.ev || 88.3;
  const lx = lg?.xIso || 0.155;
  const ls = lg?.swingSpeed || 71.8;
  const lsol = lg?.solid || 6;
  const lsw = lg?.sweetSpot || 33.2;
  const lbl = lg?.blast || 12.5;
  const lp = ((lg?.pull || 40) / 100) * ((lg?.flyBall || 25) / 100);
  const barrelMult = clamp(s.barrel / lb, 0.4, 2.6);
  const evMult = s.ev != null ? clamp(1 + (s.ev - le) * 0.028, 0.72, 1.4) : 1;
  const xIsoMult = s.xIso != null ? clamp(s.xIso / lx, 0.45, 2.3) : 1;
  const pullAir =
    s.pull != null && s.flyBall != null ? (s.pull / 100) * (s.flyBall / 100) : lp;
  const pullMult = clamp(pullAir / Math.max(lp, 0.04), 0.78, 1.32);
  const speed = s.swingSpeed;
  const speedMult = speed != null ? clamp(1 + (speed - ls) * 0.016, 0.82, 1.28) : 1;
  const solidMult = s.solid != null ? clamp(s.solid / lsol, 0.4, 2.2) : 1;
  const sweetMult = s.sweetSpot != null ? clamp(s.sweetSpot / lsw, 0.7, 1.45) : 1;
  const airborne =
    (s.flyBall != null && s.flyBall >= 20) || (s.sweetSpot != null && s.sweetSpot >= 30);
  const blastMult =
    s.blast != null && airborne ? clamp(s.blast / lbl, 0.5, 2.2) : null;
  const value = blastMult
    ? clamp(
        0.34 * barrelMult +
          0.1 * blastMult +
          0.14 * xIsoMult +
          0.1 * sweetMult +
          0.08 * evMult +
          0.08 * solidMult +
          0.08 * pullMult +
          0.08 * speedMult,
        0.4,
        2.35,
      )
    : clamp(
        0.34 * barrelMult +
          0.16 * xIsoMult +
          0.12 * sweetMult +
          0.1 * evMult +
          0.1 * solidMult +
          0.08 * pullMult +
          0.1 * speedMult,
        0.4,
        2.35,
      );
  const bits = [`${fmt1(s.barrel)}% barrels`];
  if (blastMult != null && s.blast != null) bits.push(`${fmt1(s.blast)}% blast`);
  if (s.sweetSpot != null && s.sweetSpot >= 35) bits.push(`${fmt1(s.sweetSpot)}% sweet`);
  if (s.solid != null) bits.push(`${fmt1(s.solid)}% solid`);
  if (s.ev != null) bits.push(`${fmt1(s.ev)} EV`);
  if (speed != null) bits.push(`${fmt1(speed)} bat`);
  if (s.xIso != null) bits.push(`xISO ${s.xIso.toFixed(3)}`);
  return { value, label: bits.join(" · ") };
}

function familySide(week: WeekContact, family: MixFamily): SideContact {
  return family === "hard" ? week.vsHard : family === "break" ? week.vsBreak : week.vsOff;
}

function pitchMix(
  week: WeekContact | null | undefined,
  family: MixFamily | null,
  hardPct: number | null | undefined,
  lgBarrel: number,
  arsenal?: ArsenalPitch[] | null,
): { value: number; label: string } | null {
  if (!week) return null;
  const prior = (lgBarrel || 7.1) / 100;
  if (arsenal && arsenal.length > 0) {
    let num = 0;
    let den = 0;
    const contrib: Array<{ code: string; share: number; rate: number; bbe: number }> = [];
    for (const p of arsenal) {
      if (p.pct < 0.08) continue;
      const exact = week.byPitch[p.code];
      let side: SideContact | null = null;
      let used = p.code;
      if (exact && exact.bbe >= 4) {
        side = exact;
      } else {
        const fam = pitchFamily(p.code);
        if (fam) {
          const famSide = familySide(week, fam);
          if (famSide.bbe >= 6) {
            side = famSide;
            used = fam;
          }
        }
      }
      if (!side) continue;
      const rate = shrinkRate(side.barrels, side.bbe, prior, 10);
      num += p.pct * rate;
      den += p.pct;
      contrib.push({ code: used, share: p.pct, rate, bbe: side.bbe });
    }
    if (den >= 0.35 && contrib.length > 0) {
      const blended = num / den;
      const vsLg = blended / Math.max(prior, 0.02);
      const value = clamp(1 + (vsLg - 1) * 0.8, 0.72, 1.48);
      const top = [...contrib].sort((a, b) => b.share * b.rate - a.share * a.rate)[0];
      const pct = 100 * top.rate;
      return {
        value,
        label: `${fmt1(pct)}% vs ${top.code} · SP ${Math.round(top.share * 100)}%`,
      };
    }
  }
  if (!family || hardPct == null) return null;
  const side = familySide(week, family);
  if (side.bbe < 6) return null;
  const rate = shrinkRate(side.barrels, side.bbe, prior, 10);
  const vsLg = rate / Math.max(prior, 0.02);
  const tilt = clamp(Math.abs(hardPct - 0.48) / 0.22, 0.35, 1);
  const value = clamp(1 + (vsLg - 1) * tilt, 0.72, 1.48);
  const pct = (100 * side.barrels) / side.bbe;
  const tag = family === "hard" ? "vs hard" : family === "break" ? "vs break" : "vs off";
  return {
    value,
    label: `${fmt1(pct)}% ${tag} · SP ${Math.round(hardPct * 100)}% hard`,
  };
}

function zoneFit(
  week: WeekContact | null | undefined,
  pitcher: SavantPitcher | null | undefined,
  lg: SavantLeague | null | undefined,
): { value: number; label: string } | null {
  if (!week || pitcher?.inZone == null) return null;
  if (week.heart.bbe + week.chase.bbe < 8) return null;
  const prior = (lg?.barrel || 7.1) / 100;
  const heartRate =
    week.heart.bbe >= 5 ? shrinkRate(week.heart.barrels, week.heart.bbe, prior, 10) : null;
  const chaseRate =
    week.chase.bbe >= 4 ? shrinkRate(week.chase.barrels, week.chase.bbe, prior, 10) : null;
  if (heartRate == null && chaseRate == null) return null;
  const lgZone = lg?.inZone || 49;
  const zoneTilt = clamp((pitcher.inZone - lgZone) / 8, -1, 1);
  let hitterTilt = 0;
  if (heartRate != null && chaseRate != null) {
    hitterTilt = clamp((heartRate - chaseRate) / 0.08, -1, 1);
  } else if (heartRate != null) {
    const overall = shrinkRate(week.barrels, week.bbe, prior, 10);
    hitterTilt = clamp((heartRate - overall) / 0.05, -1, 1);
  } else if (chaseRate != null) {
    const overall = shrinkRate(week.barrels, week.bbe, prior, 10);
    hitterTilt = clamp((overall - chaseRate) / 0.05, -1, 1);
  }
  const match = hitterTilt * zoneTilt;
  if (Math.abs(match) < 0.25) return null;
  const value = clamp(1 + match * 0.1, 0.88, 1.14);
  const tag =
    match > 0
      ? hitterTilt > 0
        ? "heart vs in-zone"
        : "chase vs expand"
      : hitterTilt > 0
        ? "heart vs expand"
        : "chase vs in-zone";
  return { value, label: tag };
}

function contactVolume(
  kPct: number | null | undefined,
  lgK: number,
): { value: number; label: string } | null {
  if (kPct == null || kPct < 8 || kPct > 45) return null;
  const lg = lgK || 22.4;
  const value = clamp(lg / kPct, 0.84, 1.18);
  return { value, label: `${fmt1(kPct)}% K` };
}

function matrixMix(
  pitcherRows: PitchMixRow[] | null | undefined,
  hitterRows: PitchMixRow[] | null | undefined,
  lgBarrel: number,
): { value: number; label: string } | null {
  if (!pitcherRows?.length || !hitterRows?.length) return null;
  const lg = Math.max((lgBarrel || 7.1) / 100, 0.02);
  const lgIso = 0.155;
  let num = 0;
  let den = 0;
  const contrib: Array<{
    name: string;
    share: number;
    vsLg: number;
    barrelPct: number | null;
    iso: number | null;
  }> = [];
  for (const pit of pitcherRows) {
    if (pit.pct < 0.08) continue;
    const hit = hitterRows.find((r) => r.code === pit.code);
    if (!hit || hit.n < 4) continue;
    const barrels = hit.barrelPct != null ? (hit.barrelPct / 100) * hit.n : null;
    const barrelRate =
      barrels != null ? shrinkRate(barrels, hit.n, lg, 12) : null;
    const isoMult = hit.iso != null ? clamp(hit.iso / lgIso, 0.5, 2.2) : null;
    const vsLg =
      barrelRate != null && isoMult != null
        ? 0.7 * (barrelRate / lg) + 0.3 * isoMult
        : barrelRate != null
          ? barrelRate / lg
          : (isoMult ?? 0);
    if (vsLg <= 0) continue;
    num += pit.pct * vsLg;
    den += pit.pct;
    contrib.push({
      name: pit.name,
      share: pit.pct,
      vsLg,
      barrelPct: hit.barrelPct,
      iso: hit.iso,
    });
  }
  if (den < 0.28 || contrib.length === 0) return null;
  const blended = num / den;
  const value = clamp(1 + (blended - 1) * 0.7, 0.72, 1.42);
  const top = [...contrib].sort((a, b) => b.share * b.vsLg - a.share * a.vsLg)[0];
  const dmg =
    top.barrelPct != null
      ? `${fmt1(top.barrelPct)}% BRL`
      : top.iso != null
        ? `ISO ${top.iso.toFixed(2)}`
        : "";
  return {
    value,
    label: `${top.name} ${Math.round(top.share * 100)}% · ${dmg}`.trim(),
  };
}

function pitcherAir(
  s: SavantPitcher | null | undefined,
  lg: SavantLeague | null | undefined,
): { value: number; label: string } | null {
  if (!s || s.pa < 40) return null;
  const lb = lg?.barrel || 7.1;
  const lf = lg?.flyBall || 25;
  const le = lg?.ev || 88.3;
  const barrelMult = s.barrel != null ? clamp(s.barrel / lb, 0.5, 2.1) : 1;
  const fbMult = s.flyBall != null ? clamp(s.flyBall / lf, 0.55, 1.8) : 1;
  const evMult = s.ev != null ? clamp(1 + (s.ev - le) * 0.03, 0.7, 1.45) : 1;
  const value = clamp(0.5 * barrelMult + 0.3 * fbMult + 0.2 * evMult, 0.55, 1.75);
  const bits: string[] = [];
  if (s.barrel != null) bits.push(`${fmt1(s.barrel)}% barrels allowed`);
  if (s.flyBall != null) bits.push(`${fmt1(s.flyBall)}% FB`);
  if (s.ev != null) bits.push(`${fmt1(s.ev)} EV`);
  return { value, label: bits.join(" · ") || "Statcast air" };
}

function truePlatoon(input: {
  bats: string;
  throws: string | null;
  vsL?: { hr: number; pa: number } | null;
  vsR?: { hr: number; pa: number } | null;
  week?: WeekContact | null;
  lgHrPa: number;
  lgBarrel: number;
}): Factor {
  const generic = platoonFactor(input.bats, input.throws);
  if (!input.throws) return generic;
  const hand = input.throws === "L" ? "L" : "R";
  const split = hand === "L" ? input.vsL : input.vsR;
  let value = generic.value;
  const bits: string[] = [generic.label];
  if (split && split.pa >= 30) {
    const rate = shrinkRate(split.hr, split.pa, input.lgHrPa, 55);
    const actual = clamp(rate / input.lgHrPa, 0.55, 1.85);
    value = clamp(0.35 * generic.value + 0.65 * actual, 0.72, 1.38);
    bits[0] = `${split.hr} HR / ${split.pa} PA vs ${hand}HP`;
  }
  const side = hand === "L" ? input.week?.vsL : input.week?.vsR;
  if (side && side.bbe >= 6) {
    const prior = (input.lgBarrel || 7.1) / 100;
    const weekRate = shrinkRate(side.barrels, side.bbe, prior, 12);
    const weekMult = clamp(weekRate / prior, 0.65, 2.0);
    value = clamp(0.55 * value + 0.45 * weekMult, 0.7, 1.42);
    bits.push(`${fmt1((100 * side.barrels) / side.bbe)}% barrels last 7 vs ${hand}HP`);
  }
  return { value, label: bits.join(" · ") };
}

function weekForm(
  week: WeekContact | null | undefined,
  season: SavantBatter | null | undefined,
  lgBarrel: number,
  recentHr: number | null,
  recentPa: number | null,
  batterRate: number,
): Factor {
  if (week && week.bbe >= 8) {
    const seasonPct = (season?.barrel ?? lgBarrel) / 100;
    const weekRate = shrinkRate(week.barrels, week.bbe, seasonPct, 14);
    let value = clamp(weekRate / Math.max(seasonPct, 0.02), 0.8, 1.22);
    const raw = barrelPct(week);
    const bits: string[] = [];
    if (raw != null) bits.push(`${fmt1(raw)}% barrels last 10 · ${week.barrels}/${week.bbe} BBE`);
    if (week.batSpeedN >= 8 && season?.swingSpeed != null) {
      const weekSpd = week.batSpeedSum / week.batSpeedN;
      if (weekSpd <= season.swingSpeed - 2) {
        value = clamp(value * 0.92, 0.78, 1.22);
        bits.push(`cooled bat ${fmt1(weekSpd)}`);
      } else if (weekSpd >= 75) {
        bits.push(`${fmt1(weekSpd)} bat last 10`);
      }
    }
    if (week.bbe >= 10) {
      const weakPct = (100 * week.weak) / week.bbe;
      const solidPct = (100 * week.solid) / week.bbe;
      if (weakPct >= 18) {
        value = clamp(value * 0.93, 0.78, 1.22);
        bits.push(`${fmt1(weakPct)}% weak`);
      } else if (solidPct >= 12) {
        bits.push(`${fmt1(solidPct)}% solid last 10`);
      }
    }
    const ev100 = ev100Flags(week);
    const tanks = tankFlags(week);
    const shape = weekShape(week);
    if (tanks.count >= 5) {
      value = clamp(value * 1.07, 0.78, 1.22);
      bits.push(`${tanks.count} tanks last 10`);
    } else if (tanks.count >= 3) {
      value = clamp(value * 1.05, 0.78, 1.22);
      bits.push(`${tanks.count} tanks last 10`);
    } else if (tanks.last1) {
      value = clamp(value * 1.04, 0.78, 1.22);
      bits.push("tank last game");
    }
    if (ev100.last1 && ev100.maxEvLast1 != null && !tanks.last1) {
      value = clamp(value * (ev100.maxEvLast1 >= 105 ? 1.07 : 1.05), 0.78, 1.22);
      bits.push(`${fmt1(ev100.maxEvLast1)} last game`);
      if (ev100.hot100Last3) {
        value = clamp(value * 1.03, 0.78, 1.22);
        bits.push(`${ev100.n100Last3}× 100+ last 3`);
      }
    } else if (!tanks.last1 && ev100.hot100Last3) {
      value = clamp(value * 1.06, 0.78, 1.22);
      bits.push(`${ev100.n100Last3}× 100+ last 3`);
    } else if (!tanks.last1 && ev100.last3 && ev100.n100Last3 >= 2) {
      value = clamp(value * 1.03, 0.78, 1.22);
      bits.push(`${ev100.n100Last3}× 100+ last 3`);
    }
    if (shape.pullPct != null && shape.pullAirPct != null) {
      if (shape.pullPct < 33) {
        value = clamp(value * 0.95, 0.78, 1.22);
        bits.push(`${fmt1(shape.pullPct)}% pull`);
      } else if (shape.pullPct >= 40 && shape.pullAirPct >= 18) {
        value = clamp(value * 1.04, 0.78, 1.22);
        bits.push(`${fmt1(shape.pullAirPct)}% pull air`);
      }
    }
    if (shape.idealAaPct != null) {
      if (shape.idealAaPct >= 55) {
        value = clamp(value * 1.03, 0.78, 1.22);
        bits.push(`${fmt1(shape.idealAaPct)}% ideal AA`);
      } else if (shape.idealAaPct < 35) {
        value = clamp(value * 0.96, 0.78, 1.22);
        bits.push(`${fmt1(shape.idealAaPct)}% ideal AA`);
      }
    }
    if (shape.launchBandLast3) {
      value = clamp(value * 1.04, 0.78, 1.22);
      bits.push("20–30° last 3");
    } else if (shape.launchBandLast5) {
      value = clamp(value * 1.03, 0.78, 1.22);
      bits.push("20–30° last 5");
    }
    return {
      value,
      label: bits.join(" · ") || "Last-week contact",
    };
  }
  if (recentPa != null && recentHr != null && recentPa >= 18) {
    const recentRate = shrinkRate(recentHr, recentPa, batterRate, 55);
    return {
      value: clamp(recentRate / Math.max(batterRate, 0.004), 0.84, 1.14),
      label: `${recentHr} HR in last ${recentPa} PA`,
    };
  }
  return { value: 1, label: "Season baseline" };
}

function lookReasons(input: {
  savant?: SavantBatter | null;
  week?: WeekContact | null;
  throws: string | null;
  parkIdx: number;
  platoon: number;
  weather: Factor;
  pitcherAir: number | null;
  mix: number | null;
  mixLabel: string | null;
  zoneLabel: string | null;
  pitcherKPct: number | null;
  sprayLabel: string | null;
  order: number;
  ev100: ReturnType<typeof ev100Flags>;
}): string[] {
  const out: string[] = [];
  const s = input.savant;
  const w = input.week;
  const hand = input.throws === "L" ? "L" : input.throws === "R" ? "R" : null;
  const side = hand === "L" ? w?.vsL : hand === "R" ? w?.vsR : null;
  if (side && side.bbe >= 6) {
    const pct = (100 * side.barrels) / side.bbe;
    if (pct >= 12) out.push(`${fmt1(pct)}% vs ${hand}HP last 10`);
  }
  if (input.mix != null && input.mix >= 1.1 && input.mixLabel) {
    const short = input.mixLabel.split(" · ")[0];
    if (short) out.push(short);
  }
  if (w && w.tanks >= 3) out.push(`${w.tanks} tanks last 10`);
  else if (w && (w.games[0]?.nTanks ?? 0) > 0) out.push("tank last game");
  if (input.ev100.last1 && input.ev100.maxEvLast1 != null && input.ev100.maxEvLast1 >= 100 && !(w && (w.games[0]?.nTanks ?? 0) > 0)) {
    out.push(`${fmt1(input.ev100.maxEvLast1)} last game`);
  }
  if (input.ev100.hot100Last3) out.push(`${input.ev100.n100Last3}× 100+ last 3`);
  if (input.zoneLabel) out.push(input.zoneLabel);
  const shape = weekShape(w);
  if (shape.launchBandLast3) out.push("20–30° last 3");
  else if (shape.launchBandLast5) out.push("20–30° last 5");
  if (shape.pullAirPct != null && shape.pullPct != null && shape.pullPct >= 40 && shape.pullAirPct >= 18) {
    out.push(`${fmt1(shape.pullAirPct)}% pull air`);
  }
  if (shape.idealAaPct != null && shape.idealAaPct >= 55) {
    out.push(`${fmt1(shape.idealAaPct)}% ideal AA`);
  }
  if (w && w.bbe >= 8) {
    const pct = barrelPct(w);
    if (pct != null && pct >= 12) out.push(`${fmt1(pct)}% barrels last 10`);
  }
  if (s?.blast != null && s.blast >= 16 && ((s.flyBall ?? 0) >= 20 || (s.sweetSpot ?? 0) >= 30)) {
    out.push(`${fmt1(s.blast)}% blast`);
  }
  if (s?.sweetSpot != null && s.sweetSpot >= 38) out.push(`${fmt1(s.sweetSpot)}% sweet`);
  if (s?.swingSpeed != null && s.swingSpeed >= 75) out.push(`${fmt1(s.swingSpeed)} bat`);
  if (s?.barrel != null && s.barrel >= 12) out.push(`${fmt1(s.barrel)}% barrels`);
  if (s?.solid != null && s.solid >= 8) out.push(`${fmt1(s.solid)}% solid`);
  if (s?.ev != null && s.ev >= 92) out.push(`${fmt1(s.ev)} EV`);
  if (s?.xIso != null && s.xIso >= 0.24) out.push(`xISO ${s.xIso.toFixed(3)}`);
  else if (s?.xSlg != null && s.xSlg >= 0.45) out.push(`xSLG ${s.xSlg.toFixed(3)}`);
  if (input.pitcherAir != null && input.pitcherAir >= 1.12) out.push("Air starter");
  if (input.pitcherKPct != null && input.pitcherKPct <= 19) out.push(`${fmt1(input.pitcherKPct)}% K`);
  if (input.parkIdx >= 110) out.push(`${input.parkIdx} air`);
  if (input.sprayLabel) out.push(input.sprayLabel);
  if (input.platoon >= 1.08 && !out.some((r) => r.includes("vs"))) out.push("Platoon");
  if (input.order <= 3) out.push(`#${input.order}`);
  return out.slice(0, 4);
}

function fmt1(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
