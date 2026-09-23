import { clamp } from "./prob.ts";
import type { PaSim, PlayerPrediction } from "./types.ts";

const N = 4000;
const PEN_HR_PA = 0.026;

function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function poisson(lambda: number, rand: () => number): number {
  if (lambda <= 0) return 0;
  if (lambda > 18) lambda = 18;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rand();
  } while (p > L);
  return k - 1;
}

function looksIn(order: number, remBf: number, startSlot: number): number {
  if (remBf <= 0) return 0;
  let n = 0;
  for (let i = 0; i < remBf; i++) {
    const slot = ((startSlot - 1 + i) % 9) + 1;
    if (slot === order) n += 1;
  }
  return n;
}

function in10(p: number): number {
  if (!Number.isFinite(p) || p <= 0) return 0;
  return Math.max(1, Math.min(9, Math.round(p * 10)));
}

export function paIsTheBet(p: PlayerPrediction): boolean {
  const pit = p.pitcher;
  if (!pit) return false;
  const d = p.signal?.decision;
  const mixGuy = !!d?.both20 || (d?.mixHr ?? 0) >= 2 || p.ticket === "play";
  if (!mixGuy) return false;
  const pitches = pit.starterPitches ?? 0;
  if (pit.likelyExit) return true;
  if (p.gameStatus === "live" && pit.stuff?.down && pitches >= 70) return true;
  return false;
}

export function simPa(p: PlayerPrediction, trials = N): PaSim | null {
  if (!paIsTheBet(p) || !p.pitcher) return null;
  const pit = p.pitcher;
  const thrown = pit.starterPitches ?? (pit.likelyExit ? 90 : 80);
  const cap = pit.stuff?.down ? 98 : 105;
  const meanBf = Math.max(0, (cap - thrown) / 3.4);
  const order = Math.min(9, Math.max(1, Math.round(p.battingOrder)));
  const pSp = clamp(p.pHrPa * (pit.stuff?.down ? 1.12 : 1), 0.015, 0.12);
  const juice = (p.season?.hr ?? 0) >= 12 || (p.statcast?.barrel ?? 0) >= 10;
  const pPen = clamp(PEN_HR_PA * (juice ? 1.15 : 0.85), 0.015, 0.05);
  const rand = rng(p.playerId * 10_000 + p.gamePk + thrown);
  const rates: number[] = [];
  let one = 0;
  let stay = 0;
  for (let t = 0; t < trials; t++) {
    const remBf = poisson(meanBf, rand);
    const start = 1 + Math.floor(rand() * 9);
    const paSp = looksIn(order, remBf, start);
    const paPen = paSp === 0 ? 2 : paSp === 1 ? 1 : 0;
    const pHr = 1 - Math.pow(1 - pSp, paSp) * Math.pow(1 - pPen, paPen);
    rates.push(pHr);
    if (paSp <= 1) one += 1;
    else stay += 1;
  }
  rates.sort((a, b) => a - b);
  const mean = rates.reduce((s, n) => s + n, 0) / rates.length;
  const pLow = rates[Math.floor(rates.length * 0.1)] ?? mean;
  const pHigh = rates[Math.floor(rates.length * 0.9)] ?? mean;
  const pOne = 1 - (1 - pSp);
  const pTwo = 1 - Math.pow(1 - pSp, 2);
  const short = one >= stay;
  const line = short
    ? `He's at ${thrown} pitches. Most nights like this: ${in10(mean)} in 10. One more look is ${in10(pOne)} in 10. You're betting the next PA, not the game.`
    : `He's at ${thrown} pitches. If he stays for two looks: ${in10(pTwo)} in 10. If the pen is in: ${in10(pOne)} in 10. Don't need three.`;
  return { p: mean, pLow, pHigh, line };
}
