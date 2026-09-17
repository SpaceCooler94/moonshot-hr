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
