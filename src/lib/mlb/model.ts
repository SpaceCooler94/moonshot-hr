import { dailyParkAir, sprayPark } from "./parks";
import type { SavantBatter, SavantLeague, SavantPitcher, SideContact, WeekContact } from "./savant";
import { barrelPct, ev100Flags, pitchFamily, tankFlags, trendShape, weekShape } from "./savant";
import type { ArsenalPitch, ConfidenceBand, Factor, LineupSource, MixFamily, PitchMixRow } from "./types";
export {
  CAL_BANDS,
  DAMPING,
  LEAGUE_TBF_PER_START,
  MODEL_VERSION,
  P_HR_CAP,
  STARTER_HR_RATE,
  TAIL_CUT,
  TAIL_KEEP,
  clamp,
  expectedPa,
  pAtLeastOne,
  paVsStarter,
  publishPHr,
  shrinkRate,
  starterTbf,
  trustWeight,
} from "./prob";
import { clamp, DAMPING, expectedPa, LEAGUE_TBF_PER_START, pAtLeastOne, paVsStarter, publishPHr, shrinkRate, starterTbf } from "./prob";

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
    pitcher = { value: 1.08, label: "Staff / opener prior" };
    conf *= 0.68;
    notes.push("No established starter · staff mix prior");
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

  const missingArm =
    !input.throws && (input.pitcherBf == null || input.pitcherBf < 40) && !input.pitcherSavant;
  const tbf = missingArm
    ? clamp(LEAGUE_TBF_PER_START * 0.72, 15, 18)
    : starterTbf(input.pitcherBf, input.pitcherGs);
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
