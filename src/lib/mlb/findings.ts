import type { GameCard, PlayerPrediction, VulnerablePitcher } from "./types";
import { both20Line, findBoth20 } from "./bvp";

export type IntelFinding = {
  id: string;
  kind:
    | "look"
    | "velo"
    | "zone"
    | "park"
    | "arm"
    | "heat"
    | "fade"
    | "double"
    | "cooled"
    | "quality"
    | "wind"
    | "true"
    | "bvp"
    | "both"
    | "mixhr"
    | "loud";
  weight: number;
  headline: string;
  body: string;
  playerId: number | null;
  gamePk: number | null;
};

const KIND_LABEL: Record<IntelFinding["kind"], string> = {
  look: "The look",
  velo: "105+ heat",
  zone: "Zone clash",
  park: "Air stack",
  arm: "Arm hole",
  heat: "Last-game tank",
  fade: "Size, no stack",
  double: "Two games",
  cooled: "Cooled",
  quality: "Ahead of the box",
  wind: "Wind × spray",
  true: "Tonight's park",
  bvp: "BvP study",
  both: "20×20",
  mixhr: "HR off mix",
  loud: "Loud outs",
};

export function findingLabel(kind: IntelFinding["kind"]): string {
  return KIND_LABEL[kind];
}

export function buildFindings(
  preds: PlayerPrediction[],
  games: GameCard[],
  arms: VulnerablePitcher[],
): IntelFinding[] {
  const out: IntelFinding[] = [];
  const passers = preds
    .filter((p) => p.signal.decision.pass)
    .sort(
      (a, b) =>
        b.signal.decision.push - a.signal.decision.push ||
        b.signal.decision.score - a.signal.decision.score ||
        b.pHr - a.pHr,
    );
  const bothHits = preds
    .filter((p) => !!p.pitcher && !!findBoth20(p))
    .sort((a, b) => {
      const ba = findBoth20(a)!;
      const bb = findBoth20(b)!;
      return (
        (bb.strict ? 1 : 0) - (ba.strict ? 1 : 0) ||
        bb.hitBrl + bb.pitBrl - (ba.hitBrl + ba.pitBrl) ||
        b.signal.decision.bvp - a.signal.decision.bvp
      );
    });
  for (const [i, p] of bothHits.slice(0, 3).entries()) {
    const b = findBoth20(p)!;
    const arm = lastWord(p.pitcher!.name);
    out.push({
      id: `both:${p.playerId}:${p.gamePk}:${b.code}`,
      kind: "both",
      weight: 138 - i * 4,
      headline: `${p.name} vs ${arm} · ${b.name} ${b.hitBrl.toFixed(0)}×${b.pitBrl.toFixed(0)}`,
      body: both20Line(b, arm, p.lastName || p.name),
      playerId: p.playerId,
      gamePk: p.gamePk,
    });
  }

  const mixHrs = preds
    .filter((p) => (p.signal.decision.mixHr ?? 0) >= 2 && p.pitcher)
    .sort((a, b) => b.signal.decision.mixHr - a.signal.decision.mixHr || b.signal.decision.bvp - a.signal.decision.bvp);
  for (const [i, p] of mixHrs.slice(0, 2).entries()) {
    const arm = lastWord(p.pitcher!.name);
    out.push({
      id: `mixhr:${p.playerId}:${p.gamePk}`,
      kind: "mixhr",
      weight: 94 - i * 4,
      headline: `${p.name} · ${p.signal.decision.mixHr} HR on ${arm}'s pitch types`,
      body: `Homers in this window on pitches ${arm} actually throws — type mix, not a head-to-head log.`,
      playerId: p.playerId,
      gamePk: p.gamePk,
    });
  }

  const louds = preds
    .filter((p) => (p.week?.loudOuts ?? 0) >= 6)
    .sort((a, b) => (b.week?.loudOuts ?? 0) - (a.week?.loudOuts ?? 0));
  if (louds[0]) {
    const p = louds[0];
    const dist = p.week?.maxDist ? ` · ${Math.round(p.week.maxDist)} ft longest` : "";
    const mev = p.week?.maxEv ? ` · ${p.week.maxEv.toFixed(1)} mph` : "";
    out.push({
      id: `loud:${p.playerId}:${p.gamePk}`,
      kind: "loud",
      weight: 72,
      headline: `${p.lastName || p.name} · ${p.week!.loudOuts} loud outs last 10`,
      body: `Barreled and caught${mev}${dist}. Quality is there; the box is quiet.`,
      playerId: p.playerId,
      gamePk: p.gamePk,
    });
  }

  const look = passers[0] ?? null;

  const studies = preds
    .filter(
      (p) =>
        !!p.pitcher &&
        (p.signal.decision.bvpGrade === "best" ||
          p.signal.decision.bvpGrade === "strong" ||
          p.signal.decision.pass),
    )
    .sort(
      (a, b) =>
        b.signal.decision.bvp - a.signal.decision.bvp ||
        b.signal.decision.push - a.signal.decision.push ||
        b.pHr - a.pHr,
    );
  for (const [i, p] of studies.slice(0, 3).entries()) {
    const arm = p.pitcher ? lastWord(p.pitcher.name) : "TBD";
    out.push({
      id: `bvp:${p.playerId}:${p.gamePk}`,
      kind: "bvp",
      weight: 126 - i * 5,
      headline: `${p.name} vs ${arm} · ${p.signal.decision.bvp}`,
      body:
        (i === 0 ? "Best pairing on the slate. " : "") +
        p.signal.decision.bvpLine,
      playerId: p.playerId,
      gamePk: p.gamePk,
    });
  }

  if (look && !studies.some((s) => s.playerId === look.playerId && s.gamePk === look.gamePk)) {
    out.push({
      id: `look:${look.playerId}:${look.gamePk}`,
      kind: "look",
      weight: 100 + look.signal.decision.push,
      headline: look.name,
      body: look.signal.decision.line.replace(/^Today:\s*/, ""),
      playerId: look.playerId,
      gamePk: look.gamePk,
    });
  }

  for (const p of passers) {
    const n105 = p.week?.brl105 ?? 0;
    if (n105 >= 3) {
      const mean = p.week?.barrelEv;
      out.push({
        id: `velo:${p.playerId}:${p.gamePk}`,
        kind: "velo",
        weight: 70 + n105 * 6 + (mean ?? 0) * 0.1,
        headline: `${p.lastName || p.name} · ${n105}× 105+ last 10`,
        body: `${n105} no-doubt barrels last 10${mean != null ? ` · mean barrel ${mean.toFixed(0)} mph` : ""}${
          p.week ? ` · ${p.week.brl98} at 98–101 · ${p.week.brl102} at 102–104` : ""
        }. That is carry, not a 98 mph barrel.`,
        playerId: p.playerId,
        gamePk: p.gamePk,
      });
    }
  }

  for (const p of passers) {
    const heart = p.week?.heart;
    const edge = p.pitcher?.edge ?? null;
    const inZone = p.pitcher?.inZone ?? null;
    const heartLoud = heart != null && heart.bbe >= 6 && (heart.pct ?? 0) >= 15;
    const nibble = (edge != null && edge >= 42) || (inZone != null && inZone <= 47);
    const attacks = inZone != null && inZone >= 52;
    const arm = p.pitcher ? lastWord(p.pitcher.name) : "the starter";
    if (heartLoud && nibble) {
      out.push({
        id: `zone:${p.playerId}:${p.gamePk}`,
        kind: "zone",
        weight: 70 + Math.min(heart!.pct ?? 0, 18),
        headline: `${p.lastName || p.name} vs ${arm} · heart vs the black`,
        body: `He barrels the heart at ${heart!.pct!.toFixed(0)}% (${heart!.bbe} BBE). ${arm} locates ${
          inZone != null ? `${inZone.toFixed(0)}% in-zone` : "—"
        }${edge != null ? ` · ${edge.toFixed(0)}% edge` : ""} — nibble-frames the black. Damage is in the heart; the arm lives on the edge.`,
        playerId: p.playerId,
        gamePk: p.gamePk,
      });
    } else if (heartLoud && attacks) {
      out.push({
        id: `zonein:${p.playerId}:${p.gamePk}`,
        kind: "zone",
        weight: 68 + Math.min(heart!.pct ?? 0, 16),
        headline: `${p.lastName || p.name} vs ${arm} · heart vs in-zone`,
        body: `He barrels the heart at ${heart!.pct!.toFixed(0)}%. ${arm} is ${inZone!.toFixed(
          0,
        )}% in-zone (league ~49) — he comes into the heart. Same zone he is damaging.`,
        playerId: p.playerId,
        gamePk: p.gamePk,
      });
    }
  }

  for (const p of passers) {
    if (p.week?.tanksLast1 && p.signal.keyMatch?.loud) {
      const key = p.signal.keyMatch;
      out.push({
        id: `heat:${p.playerId}:${p.gamePk}`,
        kind: "heat",
        weight: 76 + (key.barrelPct ?? 0),
        headline: `${p.lastName || p.name} · tank last game + mix`,
        body: `Tank last game, and he barrels ${key.name} at ${
          key.barrelPct != null ? `${key.barrelPct.toFixed(0)}%` : "a loud clip"
        } (${Math.round(key.usage * 100)}% of the card). Last night’s no-doubt and tonight’s pitch are the same story.`,
        playerId: p.playerId,
        gamePk: p.gamePk,
      });
    }
  }

  const byPark = new Map<number, { air: number; name: string; hitters: PlayerPrediction[] }>();
  for (const g of games) {
    byPark.set(g.park.id, { air: g.park.airIndex, name: g.park.name, hitters: [] });
  }
  for (const p of passers) {
    const row = byPark.get(p.park.id);
    if (row) row.hitters.push(p);
  }
  for (const row of byPark.values()) {
    if (row.air < 112 || row.hitters.length === 0) continue;
    const names = row.hitters
      .slice()
      .sort((a, b) => b.signal.decision.push - a.signal.decision.push)
      .slice(0, 3);
    out.push({
      id: `park:${row.name}:${names[0].playerId}`,
      kind: "park",
      weight: 60 + (row.air - 100) + names.length * 4,
      headline: `${row.air} air at ${shortPark(row.name)}`,
      body: `${names.map((h) => h.lastName || h.name).join(", ")} clear the cut in a ${row.air} air park. Spray and carry get a real boost — still need mix, which these have.`,
      playerId: names[0].playerId,
      gamePk: names[0].gamePk,
    });
  }

  for (const arm of arms.slice(0, 6)) {
    if (arm.grade === "thin") continue;
    const targets = arm.targets.filter((t) => {
      const hit = preds.find((p) => p.playerId === t.playerId && p.gamePk === t.gamePk);
      return hit?.signal.decision.pass;
    });
    if (targets.length === 0) continue;
    const top = preds.find((p) => p.playerId === targets[0].playerId && p.gamePk === targets[0].gamePk);
    if (!top) continue;
    const k = arm.kPct != null ? `${arm.kPct.toFixed(0)}% K` : "thin K sample";
    out.push({
      id: `arm:${arm.pitcherId}:${arm.gamePk}`,
      kind: "arm",
      weight: 58 + (arm.grade === "loud" ? 12 : 4) + targets.length * 3,
      headline: `${lastWord(arm.name)} is the hole · ${k}`,
      body: `${arm.why} Cut looks against him: ${targets
        .slice(0, 3)
        .map((t) => t.lastName || t.name)
        .join(", ")}.`,
      playerId: top.playerId,
      gamePk: top.gamePk,
    });
  }

  const byId = new Map<number, PlayerPrediction[]>();
  for (const p of preds) {
    const list = byId.get(p.playerId) ?? [];
    list.push(p);
    byId.set(p.playerId, list);
  }
  for (const list of byId.values()) {
    if (list.length < 2) continue;
    const hot = list.filter((p) => p.signal.decision.pass || p.signal.decision.push >= 50);
    if (hot.length === 0) continue;
    const a = hot[0] ?? list[0];
    out.push({
      id: `dbl:${a.playerId}`,
      kind: "double",
      weight: 42 + Math.max(...list.map((p) => p.signal.decision.push)) * 0.15,
      headline: `${a.lastName || a.name} has two games`,
      body: list
        .map((p) => {
          const arm = p.pitcher ? lastWord(p.pitcher.name) : "TBD";
          return `${p.isHome ? "vs" : "@"} ${p.opponentAbbr} · ${arm}${p.signal.decision.pass ? " · clears the cut" : ""}`;
        })
        .join(". "),
      playerId: a.playerId,
      gamePk: a.gamePk,
    });
  }

  const fades = preds
    .filter((p) => !p.signal.decision.pass && p.pHr >= 0.14)
    .sort((a, b) => b.pHr - a.pHr);
  if (fades[0]) {
    const p = fades[0];
    const miss = p.signal.decision.missing ?? "the cut";
    out.push({
      id: `fade:${p.playerId}:${p.gamePk}`,
      kind: "fade",
      weight: 48 + p.pHr * 40,
      headline: `${p.lastName || p.name} is ${formatP(p.pHr)} P without the stack`,
      body: `Missing ${miss}. Size from the model is not the look. Read the bars before you treat this as tonight’s guy.`,
      playerId: p.playerId,
      gamePk: p.gamePk,
    });
  }

  for (const p of preds) {
    const w = p.week;
    if (!w?.cooled && !w?.softened) continue;
    if (p.pHr < 0.1 && p.signal.decision.push < 40 && !p.signal.keyMatch?.loud) continue;
    const bits: string[] = [];
    if (w.cooled && w.batDelta != null) bits.push(`bat speed ${w.batDelta.toFixed(1)} vs last 10`);
    if (w.softened && w.airEvDelta != null) bits.push(`airborne EV ${w.airEvDelta.toFixed(1)} vs last 10`);
    out.push({
      id: `cooled:${p.playerId}:${p.gamePk}`,
      kind: "cooled",
      weight: 72 + p.pHr * 20,
      headline: `${p.lastName || p.name} is ${w.cooled && w.softened ? "cooled and dead in the air" : w.cooled ? "cooled" : "softened airborne"}`,
      body: `${bits.join(" · ")}. Fearson filter — off The Cut until the bat/air recover. Quality last week is not tonight.`,
      playerId: p.playerId,
      gamePk: p.gamePk,
    });
  }

  for (const p of [...passers, ...preds.filter((x) => x.week?.qualityAhead && x.pHr >= 0.11)]) {
    if (!p.week?.qualityAhead) continue;
    out.push({
      id: `qual:${p.playerId}:${p.gamePk}`,
      kind: "quality",
      weight: 68 + p.signal.decision.push * 0.2,
      headline: `${p.lastName || p.name} · quality ahead of the box`,
      body: `${p.week.barrels} barrels last 10 · ${p.week.nHr} HR on those BBE. Contact quality is loud; the box is quiet. That is process, not a “due” story.`,
      playerId: p.playerId,
      gamePk: p.gamePk,
    });
  }

  for (const p of preds) {
    const kind = p.week?.windKind;
    if (!kind || kind === "none") continue;
    if (kind === "pull-out") {
      out.push({
        id: `wind:${p.playerId}:${p.gamePk}`,
        kind: "wind",
        weight: 80 + (p.signal.decision.pass ? 8 : 0),
        headline: `${p.lastName || p.name} · pull-side wind out`,
        body: p.week!.windLine,
        playerId: p.playerId,
        gamePk: p.gamePk,
      });
    } else if (kind === "pull-in" && (p.signal.decision.pass || p.pHr >= 0.12)) {
      out.push({
        id: `windin:${p.playerId}:${p.gamePk}`,
        kind: "wind",
        weight: 74,
        headline: `${p.lastName || p.name} · wind in from pull`,
        body: p.week!.windLine,
        playerId: p.playerId,
        gamePk: p.gamePk,
      });
    } else if (kind === "oppo-out" && p.signal.decision.pass) {
      out.push({
        id: `windop:${p.playerId}:${p.gamePk}`,
        kind: "wind",
        weight: 64,
        headline: `${p.lastName || p.name} · wind out, spray oppo`,
        body: p.week!.windLine,
        playerId: p.playerId,
        gamePk: p.gamePk,
      });
    }
  }

  for (const p of preds) {
    const n = p.week?.parkTrue ?? 0;
    const of = p.week?.parkTrueOf ?? 0;
    if (n >= 3 && (p.signal.decision.pass || p.pHr >= 0.12)) {
      out.push({
        id: `true:${p.playerId}:${p.gamePk}`,
        kind: "true",
        weight: 76 + n * 3,
        headline: `${p.lastName || p.name} · ${n}/${of} last-10 flies clear this fence`,
        body: `Of his recent airborne balls, ${n} would be home runs in ${p.park.name} using tonight’s wall distances — not a generic air index.`,
        playerId: p.playerId,
        gamePk: p.gamePk,
      });
    } else if (of >= 6 && n === 0 && p.pHr >= 0.13) {
      out.push({
        id: `truedead:${p.playerId}:${p.gamePk}`,
        kind: "true",
        weight: 58 + p.pHr * 20,
        headline: `${p.lastName || p.name} · 0/${of} would be HR here`,
        body: `Size is ${formatP(p.pHr)} P, but none of his last-10 flies clear ${p.park.name}’s walls. Air index is not the same as this fence.`,
        playerId: p.playerId,
        gamePk: p.gamePk,
      });
    }
  }

  const picked = new Set<string>();
  const unique: IntelFinding[] = [];
  const seenPlayerKind = new Set<string>();
  const kindCount: Partial<Record<IntelFinding["kind"], number>> = {};
  const perPlayer: Record<number, number> = {};
  const kindCap: Record<IntelFinding["kind"], number> = {
    look: 1,
    velo: 2,
    zone: 1,
    park: 1,
    arm: 1,
    heat: 1,
    fade: 1,
    double: 1,
    cooled: 1,
    quality: 1,
    wind: 1,
    true: 1,
    both: 3,
    mixhr: 2,
    loud: 1,
    bvp: 2,
  };
  out
    .sort((a, b) => b.weight - a.weight)
    .forEach((f) => {
      if (unique.length >= 7) return;
      if (picked.has(f.id)) return;
      const used = kindCount[f.kind] ?? 0;
      if (used >= kindCap[f.kind]) return;
      const pk = `${f.kind}:${f.playerId}`;
      if (f.playerId != null && seenPlayerKind.has(pk)) return;
      if (f.playerId != null && (perPlayer[f.playerId] ?? 0) >= 2) return;
      picked.add(f.id);
      if (f.playerId != null) {
        seenPlayerKind.add(pk);
        perPlayer[f.playerId] = (perPlayer[f.playerId] ?? 0) + 1;
      }
      kindCount[f.kind] = used + 1;
      unique.push(f);
    });
  return unique;
}

function lastWord(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}

function shortPark(name: string): string {
  return name.replace(/\s+(Baseball|Ball)?\s*Park$/i, "").replace(/\s+Stadium$/i, "");
}

function formatP(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}
