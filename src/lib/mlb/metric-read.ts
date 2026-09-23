import { givesUp, hrsOnMix, juiceCall, mixIso } from "./bvp.ts";
import { bookDelta } from "./book-study.ts";
import type { PlayerPrediction } from "./types.ts";

export type Tone = "loud" | "live" | "quiet" | "na";
export type Call = "best" | "yes" | "no";

export type MetricRead = { tone: Tone; word: string; line: string };

export type VsCall = {
  call: Call;
  score: number;
  title: string;
  why: string;
  chips: string[];
};

function toneOf(t: Tone, word: string, line: string): MetricRead {
  return { tone: t, word, line };
}

/** League HR bats sit ~8% barrels. 12%+ is the power cut. */
export function readBarrel(pct: number | null | undefined): MetricRead {
  if (pct == null) return toneOf("na", "—", "No barrel sample.");
  if (pct >= 12) return toneOf("loud", "loud", `${pct.toFixed(0)}% barrels — that's a true power bat (league ~8%).`);
  if (pct >= 8) return toneOf("live", "live", `${pct.toFixed(0)}% barrels — average power. Needs a pitcher hole.`);
  return toneOf("quiet", "quiet", `${pct.toFixed(0)}% barrels — contact profile. Homers here are luck unless the mix is a gift.`);
}

/** .200 xISO is extra-base juice. Under .140 is a slap bat. */
export function readXiso(n: number | null | undefined): MetricRead {
  if (n == null) return toneOf("na", "—", "No xISO.");
  if (n >= 0.2) return toneOf("loud", "loud", `xISO ${n.toFixed(3)} — extra-base power, not a punch-and-judy.`);
  if (n >= 0.16) return toneOf("live", "live", `xISO ${n.toFixed(3)} — some extra-base juice.`);
  return toneOf("quiet", "quiet", `xISO ${n.toFixed(3)} — gap guy. Don't force a homer.`);
}

export function readMixIso(n: number | null | undefined): MetricRead {
  if (n == null) return toneOf("na", "—", "No mix ISO yet.");
  if (n >= 0.22) return toneOf("loud", "mashes it", `ISO ${n.toFixed(3)} vs this mix — he punishes the pitches this guy throws.`);
  if (n >= 0.16) return toneOf("live", "ok", `ISO ${n.toFixed(3)} vs this mix — playable, not the feed.`);
  return toneOf("quiet", "dead", `ISO ${n.toFixed(3)} vs this mix — he does not mash these pitches.`);
}

export function readMixHr(n: number): MetricRead {
  if (n >= 4) return toneOf("loud", "feeds him", `${n} bombs on these pitch types — this is who the arm gives them to.`);
  if (n >= 2) return toneOf("live", "has some", `${n} HR on these types — he's in the conversation.`);
  if (n === 1) return toneOf("quiet", "one", "One HR on the mix — not a pattern.");
  return toneOf("quiet", "none", "Zero HR on the pitches this starter actually throws.");
}

export function readHr9(n: number | null | undefined): MetricRead {
  if (n == null) return toneOf("na", "—", "No HR/9.");
  if (n >= 1.4) return toneOf("loud", "bleeds", `This arm bleeds homers.`);
  if (n >= 1.1) return toneOf("live", "leaks", `This arm leaks some homers.`);
  return toneOf("quiet", "tight", `This arm keeps the ball in the park.`);
}

export function readEv(n: number | null | undefined): MetricRead {
  if (n == null) return toneOf("na", "—", "No exit velo.");
  if (n >= 92) return toneOf("loud", "loud", `${n.toFixed(0)} mph average EV — that's hard contact.`);
  if (n >= 89) return toneOf("live", "live", `${n.toFixed(0)} mph EV — playable.`);
  return toneOf("quiet", "soft", `${n.toFixed(0)} mph EV — soft. Barrels will be rare.`);
}

export function readTanks(n: number | null | undefined): MetricRead {
  const v = n ?? 0;
  if (v >= 3) return toneOf("loud", "hot", `${v} tanks last 10 — no-doubt balls. He's been close.`);
  if (v >= 1) return toneOf("live", "some", `${v} tank${v === 1 ? "" : "s"} last 10 — a near-miss, not a drought.`);
  return toneOf("quiet", "cold", "No tanks last 10 — hasn't been close to a no-doubter.");
}

export function readJuice(p: PlayerPrediction): MetricRead {
  const j = juiceCall(p);
  if (j.call === "yes") return toneOf("loud", "juice", "Real power. A homer isn't a miracle.");
  if (j.call === "lean") return toneOf("live", "some", "Fringe power. Only with a pitcher hole.");
  return toneOf("quiet", "none", "No juice. Don't bet this bat to go yard.");
}

export function vsScore(p: PlayerPrediction, codes?: string[]): number {
  if (p.lineupSource === "projected") return -2;
  if (p.battingOrder > 5) return -1;
  if (juiceCall(p).call === "no") return -1;
  const hr = hrsOnMix(p, codes);
  const iso = mixIso(p, codes) ?? 0;
  const both = p.signal.decision.both20;
  if (hr < 1 && iso < 0.16 && !both) return -1;
  let s = 0;
  if (p.ticket === "play") s += 40;
  if (both) s += 30;
  if (hr >= 4) s += 25;
  else if (hr >= 2) s += 15;
  else if (hr === 1) s += 4;
  if (iso >= 0.22) s += 20;
  else if (iso >= 0.16) s += 10;
  if (juiceCall(p).call === "yes") s += 10;
  if (p.battingOrder <= 4) s += 5;
  s += bookDelta(p.book);
  const vs3 = p.splits?.vsOpp?.g3;
  if (vs3 && vs3.hr >= 2 && vs3.games >= 2) s += 12;
  else if ((p.splits?.g3.hr ?? 0) >= 2) s += 6;
  if (p.pitcher?.stuff?.down) s += 8;
  return s;
}

function vsWhy(p: PlayerPrediction, codes?: string[]): { why: string; chips: string[] } {
  const pit = p.pitcher?.name.split(" ").slice(-1)[0] ?? "this starter";
  const hr = hrsOnMix(p, codes);
  const iso = mixIso(p, codes);
  const both = p.signal.decision.both20;
  const juice = juiceCall(p);
  const pitch = givesUp(p, codes).byPitch[0];
  const chips: string[] = [];
  if (juice.call === "yes") chips.push("power");
  if (iso != null && iso >= 0.22) chips.push("mashes mix");
  else if (iso != null && iso >= 0.16) chips.push("ok mix");
  if (hr >= 2) chips.push("feeds him");
  if (both) chips.push("20×20");
  if (p.ticket === "play") chips.push("ticket");
  if (p.book && p.book.nights >= 4) chips.push(`book ${p.book.hits}/${p.book.nights}`);
  const vs3 = p.splits?.vsOpp?.g3;
  if (vs3 && vs3.hr >= 2) chips.push(`hot vs ${p.splits?.vsOpp?.abbr ?? "them"}`);
  if (p.pitcher?.stuff?.down) chips.push("stuff down");
  if (p.pitcher?.likelyExit) chips.push("pen soon");

  if (p.lineupSource === "projected") {
    return { why: "Card isn't official. Wait.", chips: ["wait"] };
  }
  if (p.battingOrder > 5) {
    return { why: `Hits ${p.battingOrder} — he won't see ${pit} enough.`, chips: ["low in order"] };
  }
  if (juice.call === "no") {
    return { why: "No power. Skip.", chips: ["no juice"] };
  }
  if (hr < 1 && !both) {
    return { why: `Zero bombs on what ${pit} throws. The book hits 2% there. Skip.`, chips: ["dead mix"] };
  }
  if (iso != null && iso < 0.16 && hr < 2 && !both) {
    return { why: `Does not mash what ${pit} throws. Skip.`, chips: ["dead mix"] };
  }
  const book = p.book?.line ? ` ${p.book.line}` : "";
  if (both && pitch) {
    return { why: `${pit}'s ${pitch.name} is a hole and he punishes it.${book}`, chips };
  }
  if (hr >= 2 && iso != null && iso >= 0.16) {
    return { why: `${pit} already gives bombs to him on this mix. That's the guy.${book}`, chips };
  }
  if (iso != null && iso >= 0.22) {
    return { why: `He mashes this mix. Hunt it.${book}`, chips };
  }
  if (book) {
    return { why: book.trim(), chips };
  }
  return { why: `Playable vs ${pit}, not the clear one.`, chips };
}

export function vsCall(p: PlayerPrediction, codes?: string[], bestId?: string): VsCall {
  const score = vsScore(p, codes);
  const { why, chips } = vsWhy(p, codes);
  const id = `${p.playerId}:${p.gamePk}`;
  let call: Call = "no";
  if (score >= 20) call = "yes";
  if (bestId && id === bestId && call === "yes") call = "best";
  const title =
    call === "best" ? "THE GUY" : call === "yes" ? "YES" : "NO";
  return { call, score, title, why, chips };
}

/** Mark exactly one BEST in a lineup (highest score among YES). */
export function markBest(players: PlayerPrediction[], codes?: string[]): Map<string, VsCall> {
  const scored = players.map((p) => ({ p, score: vsScore(p, codes) }));
  const yes = scored.filter((x) => x.score >= 20).sort((a, b) => b.score - a.score);
  const bestId = yes[0] ? `${yes[0].p.playerId}:${yes[0].p.gamePk}` : undefined;
  const out = new Map<string, VsCall>();
  for (const p of players) {
    out.set(`${p.playerId}:${p.gamePk}`, vsCall(p, codes, bestId));
  }
  return out;
}

export function playerSimple(p: PlayerPrediction): VsCall {
  return vsCall(p);
}

/** 3–5 English lines for the player sheet. Skip quiet noise. */
export function playerMetricLines(p: PlayerPrediction): string[] {
  const v = playerSimple(p);
  const extra: string[] = [];
  const brl = readBarrel(p.statcast?.barrel ?? p.statcast?.barrelPa ?? null);
  if (brl.tone === "loud") extra.push(brl.line);
  const pitch = givesUp(p).byPitch[0];
  if (pitch && pitch.hr >= 2) extra.push(`Hunt the ${pitch.name} — that's where he bleeds.`);
  extra.push(readTanks(p.week?.tanks).line);
  return [v.why, ...extra].slice(0, 4);
}

export function toneClass(t: Tone): string {
  if (t === "loud") return "text-sage";
  if (t === "quiet") return "text-danger";
  if (t === "live") return "text-gold";
  return "text-subtle";
}

export function callClass(c: Call): string {
  if (c === "best") return "bg-sage-dim text-sage";
  if (c === "yes") return "bg-gold/15 text-gold";
  return "bg-surface-2 text-subtle";
}
