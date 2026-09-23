import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyHr, LOGIT_VERSION, type HrArtifact } from "./hr-model.ts";
import { lgDefault, type BatterPrior, type GameLog, type PitcherPrior } from "./hr-features.ts";
import type { PlayerPrediction } from "./types.ts";

const MODEL = join(process.cwd(), "data", "model", "current.json");
const LOGS = join(process.cwd(), "data", "model", "logs.json");
const PRIORS = join(process.cwd(), "data", "model", "priors.json");

let cached: {
  art: HrArtifact;
  logs: { batter: Record<string, GameLog[]>; pitcher: Record<string, GameLog[]> };
  bat: Record<string, BatterPrior>;
  pit: Record<string, PitcherPrior>;
} | null = null;

function load(): typeof cached {
  if (cached) return cached;
  if (!existsSync(MODEL) || !existsSync(LOGS) || !existsSync(PRIORS)) return null;
  try {
    const art = JSON.parse(readFileSync(MODEL, "utf8")) as HrArtifact;
    const logs = JSON.parse(readFileSync(LOGS, "utf8")) as {
      batter: Record<string, GameLog[]>;
      pitcher: Record<string, GameLog[]>;
    };
    const priors = JSON.parse(readFileSync(PRIORS, "utf8")) as {
      batters: Record<string, BatterPrior>;
      pitchers: Record<string, PitcherPrior>;
    };
    cached = { art, logs, bat: priors.batters ?? {}, pit: priors.pitchers ?? {} };
    return cached;
  } catch {
    return null;
  }
}

export function readHrArtifact(): HrArtifact | null {
  return load()?.art ?? null;
}

function windOut(w: string | null | undefined): number {
  if (!w) return 0;
  const mph = Number(/(\d+)\s*mph/i.exec(w)?.[1] ?? 0);
  if (!mph) return 0;
  const low = w.toLowerCase();
  if (low.includes("out")) return mph;
  if (/\bin\b/.test(low)) return -mph;
  return 0;
}

export function overlayLogit(preds: PlayerPrediction[], date: string): boolean {
  const pack = load();
  if (!pack) return false;
  const lg = lgDefault();
  for (const p of preds) {
    const batLogs = (pack.logs.batter[String(p.playerId)] ?? []).filter((g) => g.date < date).slice(-30);
    const pitLogs = p.pitcher
      ? (pack.logs.pitcher[String(p.pitcher.id)] ?? []).filter((g) => g.date < date).slice(-8)
      : [];
    const temp = p.weather.temp != null ? Number(p.weather.temp) : null;
    const hit = applyHr(
      {
        prior: pack.bat[String(p.playerId)] ?? null,
        pitcher: p.pitcher ? pack.pit[String(p.pitcher.id)] ?? null : null,
        logs: batLogs,
        pitcherLogs: pitLogs,
        bats: p.bats,
        throws: p.pitcher?.throws ?? "R",
        venueId: p.park.id,
        order: p.battingOrder,
        temp: Number.isFinite(temp) ? temp : null,
        windOut: windOut(p.weather.wind),
        lg,
      },
      pack.art,
    );
    p.pHr = hit.p;
    p.pHrRaw = hit.pRaw;
    p.lookCall = hit.tier;
    p.lookScore = hit.p;
    const top = hit.contrib[0];
    p.lookWhy =
      hit.tier === "look"
        ? `Calibrated ${pct(hit.p)} · ${top ? `${top.name} ${top.wx >= 0 ? "lifts" : "cuts"}` : "stack"}. Cut is ${pct(pack.art.cuts.look)} (${(pack.art.cuts.lookRate * 100).toFixed(0)}% hit on calib).`
        : hit.tier === "watch"
          ? `Calibrated ${pct(hit.p)} — below the LOOK cut (${pct(pack.art.cuts.look)}).`
          : `Calibrated ${pct(hit.p)} · sit.`;
    p.lookBits = {
      power: hit.contrib.some((c) => (c.name.startsWith("iso") || c.name.startsWith("barrel")) && c.wx > 0),
      mix: hit.contrib.some((c) => c.name === "air_fb" && c.wx > 0),
      park: hit.contrib.some((c) => c.name === "park" && c.wx > 0),
      order: p.battingOrder >= 1 && p.battingOrder <= 6,
    };
  }
  preds.sort((a, b) => b.pHr - a.pHr);
  return true;
}

function pct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

export { LOGIT_VERSION };
