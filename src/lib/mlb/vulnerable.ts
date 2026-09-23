import type { GameCard, PitcherTarget, PlayerPrediction, VulnerablePitcher } from "./types.ts";
import type { SavantPitcher } from "./savant.ts";
import { clamp } from "./prob.ts";

const TOP_N = 8;
const TARGETS = 4;
const MIN_BF = 60;

export function rankVulnerablePitchers(
  games: GameCard[],
  predictions: PlayerPrediction[],
  savantPitchers: Map<number, SavantPitcher>,
): VulnerablePitcher[] {
  const rows: VulnerablePitcher[] = [];
  for (const g of games) {
    const sides: Array<{
      pit: GameCard["away"]["pitcher"];
      teamId: number;
      teamAbbr: string;
      oppAbbr: string;
      isHome: boolean;
    }> = [
      {
        pit: g.away.pitcher,
        teamId: g.away.id,
        teamAbbr: g.away.abbr,
        oppAbbr: g.home.abbr,
        isHome: false,
      },
      {
        pit: g.home.pitcher,
        teamId: g.home.id,
        teamAbbr: g.home.abbr,
        oppAbbr: g.away.abbr,
        isHome: true,
      },
    ];
    for (const s of sides) {
      const pit = s.pit;
      if (!pit || pit.id <= 0) continue;
      const sav = savantPitchers.get(pit.id);
      const sample = Math.max(pit.bf ?? 0, sav?.pa ?? 0);
      if (sample < MIN_BF) continue;
      const facing = predictions.filter((p) => p.gamePk === g.gamePk && p.pitcher?.id === pit.id);
      if (facing.length === 0) continue;
      const row = scoreArm({
        pit,
        sav,
        facing,
        teamId: s.teamId,
        teamAbbr: s.teamAbbr,
        oppAbbr: s.oppAbbr,
        isHome: s.isHome,
        gamePk: g.gamePk,
        gameTime: g.gameTime,
      });
      if (row) rows.push(row);
    }
  }
  return rows.sort((a, b) => b.score - a.score || b.combinedXhr - a.combinedXhr).slice(0, TOP_N);
}

function scoreArm(input: {
  pit: NonNullable<GameCard["away"]["pitcher"]>;
  sav: SavantPitcher | undefined;
  facing: PlayerPrediction[];
  teamId: number;
  teamAbbr: string;
  oppAbbr: string;
  isHome: boolean;
  gamePk: number;
  gameTime: string;
}): VulnerablePitcher | null {
  const { pit, sav, facing } = input;
  const order = [...facing].sort((a, b) => a.battingOrder - b.battingOrder);
  const top4 = order.filter((p) => p.battingOrder >= 1 && p.battingOrder <= 4);
  const core = top4.length ? top4 : order.slice(0, 4);
  const pitcherFactor =
    facing.reduce((n, p) => n + p.factors.pitcher.value, 0) / facing.length;
  const parkAir = facing[0].park.airIndex;
  const combinedXhr = facing.reduce((n, p) => n + p.xHr, 0);
  const barrelAllowed = sav?.barrel ?? null;
  const evAllowed = sav?.ev ?? null;
  const flyBall = sav?.flyBall ?? null;
  const kPct = pit.kPct ?? sav?.kPct ?? null;
  const both20n = facing.filter((p) => p.signal.decision.both20).length;
  const mixHrMax = Math.max(0, ...facing.map((p) => p.signal.decision.mixHr));
  const bvpMean =
    core.reduce((n, p) => n + (p.signal.decision.bvp || 0), 0) / Math.max(1, core.length);
  const bvpMax = Math.max(0, ...facing.map((p) => p.signal.decision.bvp || 0));
  const intelMean =
    core.reduce((n, p) => n + (p.forecast?.score || 0), 0) / Math.max(1, core.length);
  const pullOut = facing.some((p) => p.week?.windKind === "pull-out");
  const zoneClash = (pit.inZone ?? 0) >= 50 && facing.some((p) => (p.week?.heart.pct ?? 0) >= 12);
  const loudMix = facing.filter((p) => p.signal.keyMatch?.loud).length;

  let pts = 0;
  pts += clamp((pitcherFactor - 1) * 80, 0, 36);
  pts += barrelAllowed != null && barrelAllowed >= 9.5 ? 16 : barrelAllowed != null && barrelAllowed >= 8 ? 9 : 0;
  pts += kPct != null && kPct <= 18 ? 12 : kPct != null && kPct <= 20 ? 7 : 0;
  pts += flyBall != null && flyBall >= 32 ? 8 : flyBall != null && flyBall >= 28 ? 4 : 0;
  pts += parkAir >= 115 ? 10 : parkAir >= 108 ? 6 : 0;
  pts += both20n >= 2 ? 14 : both20n === 1 ? 8 : 0;
  pts += mixHrMax >= 5 ? 10 : mixHrMax >= 2 ? 6 : 0;
  pts += clamp(bvpMean * 0.22, 0, 22);
  pts += intelMean >= 70 ? 6 : intelMean >= 55 ? 3 : 0;
  pts += pullOut ? 6 : 0;
  pts += zoneClash ? 6 : 0;
  pts += loudMix >= 3 ? 5 : 0;
  const score = clamp(pts, 0, 100);

  const layers: VulnerablePitcher["layers"] = [
    {
      key: "air",
      pass: pitcherFactor >= 1.1,
      line: `${pitcherFactor.toFixed(2)}× air allowed`,
    },
    {
      key: "brl",
      pass: (barrelAllowed ?? 0) >= 8,
      line: barrelAllowed != null ? `${barrelAllowed.toFixed(1)}% BRL allowed` : "BRL allowed —",
    },
    {
      key: "k",
      pass: kPct != null && kPct <= 20,
      line: kPct != null ? `${kPct.toFixed(0)}% K` : "K —",
    },
    {
      key: "both",
      pass: both20n >= 1,
      line: both20n ? `${both20n}× 20×20 in this order` : "No 20×20 in the order",
    },
    {
      key: "mixhr",
      pass: mixHrMax >= 2,
      line: mixHrMax ? `${mixHrMax} HR on his pitch types (max in order)` : "No mix HR in-window",
    },
    {
      key: "bvp",
      pass: bvpMean >= 70,
      line: `1–4 BvP ${bvpMean.toFixed(0)} · best ${bvpMax.toFixed(0)}`,
    },
    {
      key: "park",
      pass: parkAir >= 108,
      line: facing[0].park.airLabel,
    },
    {
      key: "zone",
      pass: zoneClash,
      line: zoneClash
        ? `${pit.inZone?.toFixed(0)}% in-zone · heart barrels in the order`
        : pit.inZone != null
          ? `${pit.inZone.toFixed(0)}% in-zone`
          : "Zone —",
    },
  ];

  const targets: PitcherTarget[] = [...facing]
    .sort((a, b) => (b.signal.decision.bvp || 0) - (a.signal.decision.bvp || 0) || b.pHr - a.pHr)
    .slice(0, TARGETS)
    .map((p) => ({
      playerId: p.playerId,
      gamePk: p.gamePk,
      name: p.name,
      lastName: p.lastName,
      teamAbbr: p.teamAbbr,
      pHr: p.pHr,
      grade: p.signal.grade,
      keyPitch: keyPitchLine(p),
      bvp: p.signal.decision.bvp,
      bvpGrade: p.signal.decision.bvpGrade,
      both20: p.signal.decision.both20,
      mixHr: p.signal.decision.mixHr,
      intel: p.forecast?.score ?? 0,
    }));

  const grade: VulnerablePitcher["grade"] =
    score >= 68 || (barrelAllowed != null && barrelAllowed >= 9.5 && both20n >= 1)
      ? "loud"
      : score >= 50
        ? "live"
        : "thin";

  return {
    pitcherId: pit.id,
    name: pit.name,
    throws: pit.throws,
    teamId: input.teamId,
    teamAbbr: input.teamAbbr,
    opponentAbbr: input.oppAbbr,
    isHome: input.isHome,
    gamePk: input.gamePk,
    gameTime: input.gameTime,
    parkAir,
    parkLabel: facing[0].park.airLabel,
    hr: pit.hr,
    bf: pit.bf,
    hr9: pit.hr9,
    barrelAllowed,
    evAllowed,
    flyBall,
    kPct,
    whiffPct: pit.whiffPct ?? sav?.whiff ?? null,
    whip: pit.whip,
    pitcherFactor,
    combinedXhr,
    score,
    intel: Math.round(score),
    bvpMean: Math.round(bvpMean),
    both20n,
    mixHrMax,
    layers,
    grade,
    why: whyLine({
      barrelAllowed,
      hr: pit.hr,
      bf: pit.bf,
      evAllowed,
      flyBall,
      kPct,
      target: targets[0],
      both20n,
      mixHrMax,
      parkLabel: facing[0].park.airLabel,
      parkAir,
      homeHr: facing[0].park.homeHr,
    }),
    targets,
  };
}

function keyPitchLine(p: PlayerPrediction): string | null {
  if (p.signal.decision.both20 && p.signal.keyMatch) {
    const k = p.signal.keyMatch;
    const hit = k.barrelPct != null ? k.barrelPct.toFixed(0) : "?";
    const pit = k.pitBarrelPct != null ? k.pitBarrelPct.toFixed(0) : "?";
    return `${k.name} ${hit}×${pit}`;
  }
  const k = p.signal.keyMatch;
  if (!k?.loud || k.barrelPct == null || k.barrelPct < 12) return null;
  return `${k.name} ${k.barrelPct.toFixed(0)}% BRL`;
}

function whyLine(input: {
  barrelAllowed: number | null;
  hr: number | null;
  bf: number | null;
  evAllowed: number | null;
  flyBall: number | null;
  kPct: number | null;
  target: PitcherTarget | undefined;
  both20n: number;
  mixHrMax: number;
  parkLabel: string;
  parkAir: number;
  homeHr: number | null;
}): string {
  const bits: string[] = [];
  if (input.target?.keyPitch) bits.push(`${input.target.lastName || input.target.name} · ${input.target.keyPitch}`);
  if (input.both20n >= 1 && !input.target?.both20) bits.push(`${input.both20n}× 20×20`);
  if (input.mixHrMax >= 2) bits.push(`${input.mixHrMax} HR on his pitch types`);
  if (input.barrelAllowed != null) bits.push(`${fmt1(input.barrelAllowed)}% BRL allowed`);
  if (input.hr != null && input.bf) bits.push(`${input.hr} HR / ${input.bf} BF`);
  if (input.kPct != null && input.kPct <= 22) bits.push(`${input.kPct.toFixed(0)}% K`);
  if (input.homeHr != null && input.homeHr >= 1.12) bits.push(`${input.homeHr.toFixed(2)} home HR`);
  if (input.parkAir >= 108) bits.push(input.parkLabel.split(" · ")[0] ?? `${input.parkAir} air`);
  else if (input.flyBall != null && input.flyBall >= 28) bits.push(`${fmt1(input.flyBall)}% FB`);
  return bits.slice(0, 4).join(" · ");
}

function fmt1(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
