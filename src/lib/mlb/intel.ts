import { clamp, DAMPING, pAtLeastOne, pAtLeastTwo, publishPHr } from "./prob";
import type { PlayerPrediction } from "./types";

export type IntelBar = {
  key: string;
  label: string;
  score: number;
  weight: number;
  line: string;
};

export type Forecast = {
  score: number;
  conf: number;
  pRaw: number;
  pContact: number;
  pMatch: number;
  pPark: number;
  pGame: number;
  p2plus: number;
  xHr: number;
  bars: IntelBar[];
  driver: string;
  secondary: string;
  likes: string[];
  risks: string[];
};

const LG_HR_PA = 0.031;

function unit(v: number | null | undefined, lo: number, hi: number): number {
  if (v == null || !Number.isFinite(v)) return 40;
  return clamp((100 * (v - lo)) / (hi - lo), 0, 100);
}

function layerP(mult: number, pa: number, conf: number): number {
  const pPa = clamp(LG_HR_PA * Math.pow(Math.max(0.45, mult), DAMPING), 0.003, 0.07);
  return publishPHr(pAtLeastOne(pPa, pa), conf);
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : 40;
}

export function buildForecast(p: PlayerPrediction): Forecast {
  const s = p.statcast;
  const w = p.week;
  const pit = p.pitcher;
  const key = p.signal.keyMatch;
  const d = p.signal.decision;
  const f = p.factors;
  const pa = p.expectedPa;
  const conf = p.confidence;

  const power = mean([
    unit(s?.barrel, 4, 16),
    unit(s?.hardHit, 32, 52),
    unit(s?.ev, 86, 94),
    unit(s?.xSlg, 0.36, 0.62),
    unit(s?.xIso, 0.12, 0.32),
    unit(s?.barrelPa, 4, 12),
  ]);
  const powerLine = [
    s?.barrel != null ? `${s.barrel.toFixed(1)}% BRL` : null,
    s?.hardHit != null ? `${s.hardHit.toFixed(0)}% hard` : null,
    s?.ev != null ? `${s.ev.toFixed(1)} EV` : null,
    s?.xIso != null ? `xISO ${s.xIso.toFixed(3)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const contact = mean([
    unit(s?.sweetSpot, 28, 42),
    unit(s?.blast, 10, 22),
    unit(w?.tanks ?? 0, 0, 4),
    unit(w?.brl105 ?? 0, 0, 3),
    unit(w?.maxEv || w?.maxEvLast1 || s?.ev, 100, 114),
  ]);
  const contactLine = [
    s?.sweetSpot != null ? `${s.sweetSpot.toFixed(0)}% sweet` : null,
    w ? `${w.tanks} tanks` : null,
    (w?.brl105 ?? 0) > 0 ? `${w!.brl105}× 105+` : null,
    w?.maxEv ? `${w.maxEv.toFixed(1)} max` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const cover = d.bvpLayers.find((l) => l.key === "mix")?.pass ? 70 : 35;
  const arsenal = mean([
    key?.loud ? 82 : 35,
    d.both20 ? 96 : key?.loud ? 70 : 30,
    unit(d.mixHr, 0, 5),
    cover,
    unit(key?.barrelPct, 8, 28),
  ]);
  const arsenalLine = d.both20
    ? `${key?.name ?? "pitch"} 20×20`
    : key?.loud && key.barrelPct != null
      ? `${key.name} ${key.barrelPct.toFixed(0)}% BRL`
      : "Mix is not loud";

  const pitcher = mean([
    pit?.hr9 != null ? unit(pit.hr9, 0.7, 2.1) : 40,
    pit?.kPct != null ? unit(32 - pit.kPct, 4, 16) : 40,
    pit ? 55 : 20,
  ]);
  const pitcherLine = pit
    ? `${pit.hr9 != null ? `${pit.hr9.toFixed(2)} HR/9` : "HR/9 —"} · ${pit.kPct != null ? `${pit.kPct.toFixed(0)}% K` : "K —"}`
    : "Starter TBD";

  const zone = mean([
    unit(w?.heart.pct, 6, 20),
    unit(w?.pullAirPct, 8, 28),
    unit(w?.parkTrue ?? 0, 0, 5),
    pit?.inZone != null && (w?.heart.pct ?? 0) >= 12 && pit.inZone >= 50 ? 80 : 45,
  ]);
  const zoneLine =
    (w?.parkTrue ?? 0) >= 3
      ? `${w!.parkTrue}/${w!.parkTrueOf} clear tonight's fence`
      : w?.heart.pct != null
        ? `${w.heart.pct.toFixed(0)}% BRL in the heart`
        : "Zone sample thin";

  const park = mean([
    unit(p.park.airIndex, 88, 128),
    w?.windKind === "pull-out" ? 88 : w?.windKind === "pull-in" ? 18 : 50,
  ]);
  const parkLine = p.park.airLabel;

  const opp = mean([
    unit(5 - p.battingOrder, 0, 4),
    unit(pa, 1.6, 3.8),
  ]);
  const oppLine = `#${p.battingOrder} · ${pa.toFixed(1)} PA vs SP`;

  const form = w?.cooled || w?.softened
    ? 12
    : mean([
        w?.trendUp ? 82 : 38,
        unit(w?.tanksLast3 ?? 0, 0, 3),
        w?.tanksLast1 ? 90 : 40,
        unit(w?.last3vs10 ?? 0, -8, 8),
      ]);
  const formLine = w?.cooled
    ? "Cooled bat — veto"
    : w?.softened
      ? "Softened airborne — veto"
      : (w?.trendDetail ?? "No last-10 form");

  const bars: IntelBar[] = [
    { key: "power", label: "Batter power", score: power, weight: 20, line: powerLine || "Season contact thin" },
    { key: "contact", label: "Quality of contact", score: contact, weight: 15, line: contactLine || "No last-10 BBE" },
    { key: "arsenal", label: "Arsenal match", score: arsenal, weight: 20, line: arsenalLine },
    { key: "pitcher", label: "Pitcher vulnerability", score: pitcher, weight: 15, line: pitcherLine },
    { key: "zone", label: "Zone match", score: zone, weight: 10, line: zoneLine },
    { key: "park", label: "Park / weather", score: park, weight: 10, line: parkLine },
    { key: "opp", label: "PA opportunity", score: opp, weight: 5, line: oppLine },
    { key: "form", label: "Recent form", score: form, weight: 5, line: formLine },
  ];

  const score = Math.round(
    clamp(
      bars.reduce((s0, b) => s0 + (b.score * b.weight) / 100, 0),
      0,
      100,
    ),
  );
  const ranked = [...bars].sort((a, b) => b.score * b.weight - a.score * a.weight);
  const driver = ranked[0]?.label ?? "Contact";
  const secondary = ranked[1]?.label ?? "Park / weather";

  const likes: string[] = [];
  if (d.both20) likes.push("20×20 on the same pitch");
  if (d.mixHr >= 2) likes.push(`${d.mixHr} HR on these pitch types`);
  if (key?.loud && key.barrelPct != null) likes.push(`${key.name} ${key.barrelPct.toFixed(0)}% BRL`);
  if ((w?.brl105 ?? 0) >= 2) likes.push(`${w!.brl105}× 105+ barrels last 10`);
  if (w?.tanksLast1) likes.push("Tank last game");
  if ((w?.parkTrue ?? 0) >= 3) likes.push("Flies that clear tonight's fence");
  if (p.park.airIndex >= 110) likes.push(p.park.airLabel);
  if (w?.windKind === "pull-out") likes.push(w.windLine);
  if (p.battingOrder <= 2) likes.push(`#${p.battingOrder} · extra PA vs SP`);
  if (w?.trendUp) likes.push(w.trendDetail.split(" · ")[0] ?? "Trend up");
  if (w?.qualityAhead) likes.push("Contact quality ahead of the box");
  if ((s?.barrel ?? 0) >= 12) likes.push(`${s!.barrel!.toFixed(1)}% barrels`);

  const risks: string[] = [];
  if (w?.cooled) risks.push("Cooled bat speed");
  if (w?.softened) risks.push("Softened airborne contact");
  if (p.confidenceBand === "thin") risks.push("Thin sample — P is shrunk hard");
  if (p.lineupSource === "projected") risks.push("Projected order");
  if (!pit) risks.push("Starter TBD");
  if (p.battingOrder >= 7) risks.push(`#${p.battingOrder} — short vs the starter`);
  if (w?.windKind === "pull-in") risks.push(w.windLine || "Wind in to the pull side");
  if (w?.barrelDelta != null && w.barrelDelta <= -4) risks.push(`Barrels ${w.barrelDelta.toFixed(1)} vs season`);
  if (p.gamePa > p.expectedPa + 0.2) {
    risks.push(`${(p.gamePa - p.expectedPa).toFixed(1)} PA after he exits — not in P`);
  }
  if (!key?.loud && d.mixHr < 1) risks.push("No loud pitch match");
  if (p.confidenceNotes.some((n) => /weather/i.test(n))) risks.push("Weather not posted");

  const pContact = layerP(f.batter.value, pa, conf);
  const pMatch = layerP(f.batter.value * f.pitcher.value, pa, conf);
  const pPark = layerP(f.batter.value * f.pitcher.value * f.park.value * f.platoon.value, pa, conf);
  const pRaw = layerP(1, pa, conf);

  return {
    score,
    conf: Math.round(conf * 100),
    pRaw,
    pContact,
    pMatch,
    pPark,
    pGame: p.pHr,
    p2plus: publishPHr(pAtLeastTwo(p.pHrPa, pa), conf),
    xHr: p.xHr,
    bars,
    driver,
    secondary,
    likes: likes.slice(0, 5),
    risks: risks.slice(0, 5),
  };
}

export const EMPTY_FORECAST: Forecast = {
  score: 0,
  conf: 0,
  pRaw: 0,
  pContact: 0,
  pMatch: 0,
  pPark: 0,
  pGame: 0,
  p2plus: 0,
  xHr: 0,
  bars: [],
  driver: "",
  secondary: "",
  likes: [],
  risks: [],
};
