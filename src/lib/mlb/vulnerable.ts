import type { GameCard, PlayerPrediction, VulnerablePitcher } from "./types";
import type { SavantPitcher } from "./savant";

const TOP_N = 8;
const TARGETS = 3;

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
      if (sample < 60) continue;
      const facing = predictions.filter((p) => p.gamePk === g.gamePk && p.pitcher?.id === pit.id);
      if (facing.length === 0) continue;
      const pitcherFactor =
        facing.reduce((n, p) => n + p.factors.pitcher.value, 0) / facing.length;
      const parkAir = facing[0].park.airIndex;
      const combinedXhr = facing.reduce((n, p) => n + p.xHr, 0);
      const barrelAllowed = sav?.barrel ?? null;
      const targets = [...facing]
        .sort((a, b) => b.pHr - a.pHr)
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
        }));
      const parkTilt = 0.75 + 0.25 * (parkAir / 100);
      const score = pitcherFactor * parkTilt;
      const grade =
        pitcherFactor >= 1.15 || (barrelAllowed != null && barrelAllowed >= 9.5)
          ? "loud"
          : pitcherFactor >= 1.08 || (barrelAllowed != null && barrelAllowed >= 8)
            ? "live"
            : "thin";
      rows.push({
        pitcherId: pit.id,
        name: pit.name,
        throws: pit.throws,
        teamId: s.teamId,
        teamAbbr: s.teamAbbr,
        opponentAbbr: s.oppAbbr,
        isHome: s.isHome,
        gamePk: g.gamePk,
        gameTime: g.gameTime,
        parkAir,
        parkLabel: facing[0].park.airLabel,
        hr: pit.hr,
        bf: pit.bf,
        hr9: pit.hr9,
        barrelAllowed,
        evAllowed: sav?.ev ?? null,
        flyBall: sav?.flyBall ?? null,
        kPct: pit.kPct ?? sav?.kPct ?? null,
        whiffPct: pit.whiffPct ?? sav?.whiff ?? null,
        whip: pit.whip,
        pitcherFactor,
        combinedXhr,
        score,
        grade,
        why: whyLine({
          barrelAllowed,
          hr: pit.hr,
          bf: pit.bf,
          evAllowed: sav?.ev ?? null,
          flyBall: sav?.flyBall ?? null,
          target: targets[0],
        }),
        targets,
      });
    }
  }
  return rows.sort((a, b) => b.score - a.score || b.combinedXhr - a.combinedXhr).slice(0, TOP_N);
}

function keyPitchLine(p: PlayerPrediction): string | null {
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
  target: VulnerablePitcher["targets"][0] | undefined;
}): string {
  const bits: string[] = [];
  if (input.barrelAllowed != null) bits.push(`${fmt1(input.barrelAllowed)}% barrels allowed`);
  if (input.hr != null && input.bf) bits.push(`${input.hr} HR / ${input.bf} BF`);
  else if (input.evAllowed != null && input.evAllowed >= 90) {
    bits.push(`${fmt1(input.evAllowed)} EV allowed`);
  }
  if (input.flyBall != null && input.flyBall >= 28) bits.push(`${fmt1(input.flyBall)}% FB`);
  if (input.target?.keyPitch && bits.length < 3) bits.push(input.target.keyPitch);
  return bits.slice(0, 3).join(" · ");
}

function fmt1(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
