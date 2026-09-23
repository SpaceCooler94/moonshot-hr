import { givesUp, hrsOnMix, juiceCall } from "./bvp.ts";
import type { PlayerPrediction, WalkForward } from "./types";

export type NightRead = {
  call: "play" | "sit" | "wait";
  headline: string;
  body: string;
  book: string;
  names: PlayerPrediction[];
  split?: string | null;
};

/** Where tonight's bombs actually landed vs our ranking. */
export function hrSplit(pool: PlayerPrediction[]): { n: number; top: number; below: number; line: string } | null {
  const graded = pool.filter((p) => p.actualHr != null);
  if (graded.length < 12) return null;
  const ranked = [...graded].sort((a, b) => b.pHr - a.pHr);
  const topSet = new Set(ranked.slice(0, 12).map((p) => `${p.playerId}:${p.gamePk}`));
  const homers = graded.filter((p) => (p.actualHr ?? 0) > 0);
  if (homers.length === 0) return null;
  const top = homers.filter((p) => topSet.has(`${p.playerId}:${p.gamePk}`)).length;
  const below = homers.length - top;
  const line =
    below > top
      ? `${homers.length} bats went yard · ${top} from the top 12 · ${below} from below. The bombs are not coming from the loud names.`
      : `${homers.length} bats went yard · ${top} from the top 12 · ${below} from below.`;
  return { n: homers.length, top, below, line };
}

export function bookLine(walk: WalkForward | null | undefined): string {
  if (!walk || walk.days < 20) {
    return "The book is still thin. Treat tonight as a look, not a lock.";
  }
  const times = walk.restRate > 0 ? walk.top12Rate / walk.restRate : 0;
  const cut =
    walk.cutLooks >= 40 && walk.cutRate >= 0.15
      ? " The Cut has been the sharper list — that's who we ticket."
      : "";
  return `You don't have to read the table. Over ${walk.days} nights the top names went yard about ${times >= 1.7 ? "twice" : times >= 1.3 ? "half-again" : "a bit more than"} as often as everyone else.${cut} A 2-in-10 guy still loses most days — two blanks is normal. Don't chase.`;
}

function whyHim(p: PlayerPrediction): string {
  const pit = p.pitcher?.name.split(" ").slice(-1)[0] ?? "the starter";
  const give = givesUp(p);
  const pitch = give.byPitch[0];
  const hr = hrsOnMix(p);
  const juice = juiceCall(p);
  const d = p.signal.decision;
  if (d.both20 && pitch) {
    return `${pit}'s ${pitch.name} is a 20×20 hole and ${p.lastName || p.name} is the bat that punishes it.`;
  }
  if (hr >= 2 && pitch && pitch.hr >= 1) {
    return `${pit} already gives up bombs on the ${pitch.name}. ${p.lastName || p.name} has ${hr} on those types — that's "who he feeds."`;
  }
  if (d.pass && juice.call !== "no") {
    return `${p.lastName || p.name} is on The Cut with real juice vs ${pit}. Same shape that hit in the book.`;
  }
  return p.ticketWhy || d.kasper || d.line || `${p.lastName || p.name} vs ${pit} is the cleanest look.`;
}

export function nightRead(
  pool: PlayerPrediction[],
  walk: WalkForward | null | undefined,
  official: number,
  projected: number,
): NightRead {
  const book = bookLine(walk);
  const plays = pool.filter((p) => p.ticket === "play").slice(0, 2);

  const split = hrSplit(pool);
  if (split) {
    return {
      call: split.top >= 3 && split.top >= split.below ? "play" : "sit",
      headline: `${split.top} of ${split.n} HR from the top 12.`,
      body: split.line,
      book,
      names: [],
      split: split.line,
    };
  }

  if (official === 0 && projected > 0) {
    return {
      call: "wait",
      headline: "Wait. Cards aren't official.",
      body: "The mix can flip when the nines post. Don't fire a projected order.",
      book,
      names: [],
    };
  }

  if (plays.length === 1) {
    const p = plays[0]!;
    return {
      call: "play",
      headline: `${p.lastName || p.name} is the guy.`,
      body: whyHim(p) + " One name. That's the read.",
      book,
      names: plays,
    };
  }

  if (plays.length >= 2) {
    const a = plays[0]!;
    const b = plays[1]!;
    return {
      call: "play",
      headline: `${a.lastName || a.name} first. ${b.lastName || b.name} only if you want two.`,
      body: `${whyHim(a)} ${b.lastName || b.name}: ${whyHim(b)} Don't build a card of eight.`,
      book,
      names: plays,
    };
  }

  return {
    call: "sit",
    headline: "Sit tonight.",
    body: "Nobody is both on The Cut and mashing the pitches this starter actually throws. Forcing a lean is how the slips lose. Come back when a Play lights up.",
    book,
    names: [],
  };
}
