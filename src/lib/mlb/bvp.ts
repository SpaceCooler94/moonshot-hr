import type { PlayerPrediction } from "./types";

export type Both20 = {
  code: string;
  name: string;
  usage: number;
  pitN: number;
  hitN: number;
  pitBrl: number;
  hitBrl: number;
  pitEv: number | null;
  hitEv: number | null;
  strict: boolean;
};

export function findBoth20(p: PlayerPrediction): Both20 | null {
  const mx = p.pitchMatrix;
  if (!mx) {
    const k = p.signal.keyMatch;
    if (k?.both20 && k.barrelPct != null && k.pitBarrelPct != null) {
      return {
        code: k.code,
        name: k.name,
        usage: k.usage,
        pitN: k.pitN,
        hitN: k.n,
        pitBrl: k.pitBarrelPct,
        hitBrl: k.barrelPct,
        pitEv: null,
        hitEv: k.ev,
        strict: k.barrelPct >= 20 && k.pitBarrelPct >= 20,
      };
    }
    return null;
  }
  let best: Both20 | null = null;
  let bestScore = -1;
  for (const pit of mx.pitcher) {
    if (pit.pct < 0.15 || pit.n < 8 || pit.barrelPct == null || pit.barrelPct < 18) continue;
    const hit = mx.hitter.find((r) => r.code === pit.code);
    if (!hit || hit.n < 6 || hit.barrelPct == null || hit.barrelPct < 18) continue;
    const row: Both20 = {
      code: pit.code,
      name: pit.name,
      usage: pit.pct,
      pitN: pit.n,
      hitN: hit.n,
      pitBrl: pit.barrelPct,
      hitBrl: hit.barrelPct,
      pitEv: pit.ev,
      hitEv: hit.ev,
      strict: pit.barrelPct >= 20 && hit.barrelPct >= 20,
    };
    const score = pit.barrelPct + hit.barrelPct + pit.pct * 50 + (row.strict ? 8 : 0);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}

export function both20Line(b: Both20, arm: string, batter: string): string {
  const x = `${b.hitBrl.toFixed(0)}×${b.pitBrl.toFixed(0)}`;
  return `${b.name} ${x} — ${batter} barrels it ${b.hitBrl.toFixed(1)}% (${b.hitN} BBE), ${arm} allows ${b.pitBrl.toFixed(1)}% on ${Math.round(b.usage * 100)}% of the card (${b.pitN}). Same pitch, both sides ~20+.`;
}

export type BvpLayer = {
  key: string;
  pass: boolean;
  line: string;
};

export type BvpStudy = {
  score: number;
  grade: "best" | "strong" | "live" | "fade";
  cover: number;
  headline: string;
  line: string;
  layers: BvpLayer[];
  both20: boolean;
  mixHr: number;
};

export function studyBvp(p: PlayerPrediction): BvpStudy {
  const pit = p.pitcher;
  const w = p.week;
  const key = p.signal.keyMatch;
  const arm = pit ? lastWord(pit.name) : "TBD";
  const layers: BvpLayer[] = [];
  let pts = 0;

  const { cover, line: mixLine, hits } = mixCoverage(p);
  const both = findBoth20(p);
  const mixPass = cover >= 0.18 || !!key?.loud || !!both;
  if (both?.strict) pts += 26;
  else if (both) pts += 18;
  else if (cover >= 0.4) pts += 34;
  else if (cover >= 0.28) pts += 26;
  else if (mixPass) pts += 16;
  if (!both && key?.loud && (key.barrelPct ?? 0) >= 20) pts += 6;
  layers.push({
    key: "both",
    pass: !!both,
    line: both
      ? both20Line(both, arm, p.lastName || p.name)
      : "No 20×20 pitch — pitcher allowed BRL and hitter BRL both under 18% on the same offering",
  });
  layers.push({ key: "mix", pass: mixPass, line: mixLine });

  const mixHr = mixHrCount(p);
  if (mixHr.n >= 3) pts += 14;
  else if (mixHr.n >= 2) pts += 9;
  else if (mixHr.n >= 1) pts += 4;
  layers.push({
    key: "mixHr",
    pass: mixHr.n >= 2,
    line:
      mixHr.n > 0
        ? `${mixHr.n} HR on ${arm}'s pitch types${mixHr.bits.length ? ` (${mixHr.bits.slice(0, 3).join(" · ")})` : ""} — vs the look he throws, not vs him only`
        : `0 HR on ${arm}'s pitch types in this window`,
  });

  const lo = w?.loudOuts ?? 0;
  if (lo >= 6) pts += 8;
  else if (lo >= 4) pts += 5;
  layers.push({
    key: "loud",
    pass: lo >= 4,
    line:
      lo > 0
        ? `${lo} loud outs last 10 — barreled, not HR. Crushed and caught.`
        : "No loud outs last 10",
  });

  const maxEv = w?.maxEv || w?.maxEvLast1 || 0;
  const maxDist = w?.maxDist ?? 0;
  const carryPass = maxDist >= 400 || maxEv >= 108;
  if (maxDist >= 420 || maxEv >= 110) pts += 6;
  else if (carryPass) pts += 3;
  layers.push({
    key: "carry",
    pass: carryPass,
    line:
      maxEv || maxDist
        ? `${maxEv ? `${maxEv.toFixed(1)} mph` : "—"}${maxDist ? ` · ${Math.round(maxDist)} ft longest` : ""} last 10`
        : "No max EV / distance",
  });

  const brlPaWeek =
    w && p.recent && p.recent.pa >= 18 ? (100 * w.barrels) / p.recent.pa : null;
  const brlPa = brlPaWeek ?? p.statcast?.barrelPa ?? null;
  const brlPaPass = brlPa != null && brlPa >= 7;
  if (brlPa != null && brlPa >= 10) pts += 8;
  else if (brlPaPass) pts += 5;
  layers.push({
    key: "brlPa",
    pass: brlPaPass,
    line:
      brlPa != null
        ? `${brlPa.toFixed(1)}% barrels/PA${brlPaWeek != null ? " last 10" : " season"} (7% cut · this is the PA event, not BBE)`
        : "No barrel/PA sample",
  });

  const hrfb = w?.hrFb ?? p.statcast?.hrFb ?? null;
  const hrfbPass = hrfb != null && hrfb >= 16;
  if (hrfb != null && hrfb >= 22) pts += 8;
  else if (hrfbPass) pts += 5;
  layers.push({
    key: "hrfb",
    pass: hrfbPass,
    line:
      hrfb != null
        ? `${hrfb.toFixed(0)}% HR/FB${w?.hrFb != null ? ` last 10 (${w.nHr}/${w.nFly} FB)` : " season"} · bat speed maps here`
        : "No HR/FB sample",
  });

  const blast = p.statcast?.blast ?? null;
  const sq = p.statcast?.squaredUp ?? null;
  const blastPass = blast != null && blast >= 16;
  if (blast != null && blast >= 20) pts += 7;
  else if (blastPass) pts += 4;
  layers.push({
    key: "blast",
    pass: blastPass,
    line:
      blast != null
        ? `${blast.toFixed(1)}% blast${sq != null ? ` · ${sq.toFixed(0)}% squared-up` : ""} (16% cut · flush + bat speed)`
        : "No blast tracking",
  });

  const plat = p.factors.platoon.value >= 1.05;
  if (plat) pts += 10;
  layers.push({ key: "platoon", pass: plat, line: p.factors.platoon.label });

  const heart = w?.heart;
  const heartPct = heart?.pct ?? null;
  const heartN = heart?.bbe ?? 0;
  const inZone = pit?.inZone ?? null;
  const edge = pit?.edge ?? null;
  const heartLoud = heartPct != null && heartN >= 6 && heartPct >= 14;
  const nibble = (edge != null && edge >= 42) || (inZone != null && inZone <= 47);
  const attacks = inZone != null && inZone >= 52;
  let zonePass = false;
  let zoneLine = "No zone sample";
  if (heartLoud && nibble) {
    zonePass = true;
    pts += 14;
    zoneLine = `heart ${heartPct!.toFixed(0)}% BRL vs ${arm} ${edge != null ? `${edge.toFixed(0)}% edge` : "nibble"} — damage in the heart, arm on the black`;
  } else if (heartLoud && attacks) {
    zonePass = true;
    pts += 12;
    zoneLine = `heart ${heartPct!.toFixed(0)}% BRL vs ${inZone!.toFixed(0)}% in-zone — same zone he damages`;
  } else if (heartLoud) {
    zonePass = true;
    pts += 6;
    zoneLine = `heart ${heartPct!.toFixed(0)}% BRL last 10`;
  } else if (nibble) {
    zoneLine = `${arm} nibble-frames (${edge != null ? `${edge.toFixed(0)}% edge` : "expand"}) — need heart damage`;
  } else if (inZone != null) {
    zoneLine = `${arm} ${inZone.toFixed(0)}% in-zone · ${edge != null ? `${edge.toFixed(0)}% edge` : "no edge"}`;
  }
  layers.push({ key: "zone", pass: zonePass, line: zoneLine });

  const kPct = pit?.kPct ?? null;
  const armHole = (kPct != null && kPct <= 20) || p.factors.pitcher.value >= 1.1;
  if (kPct != null && kPct <= 18) pts += 12;
  else if (armHole) pts += 8;
  const armLine = pit
    ? `${arm} ${kPct != null ? `${kPct.toFixed(0)}% K` : "no K%"}${
        pit.hr9 != null ? ` · ${pit.hr9.toFixed(2)} HR/9` : ""
      } · ${p.factors.pitcher.label}`
    : "SP TBD";
  layers.push({ key: "arm", pass: armHole, line: armLine });

  const heat =
    !!w?.tanksLast1 ||
    (w?.tanks ?? 0) >= 3 ||
    w?.trendUp === true ||
    (w?.brl105 ?? 0) >= 2;
  if (w?.tanksLast1) pts += 12;
  else if ((w?.brl105 ?? 0) >= 3) pts += 10;
  else if (heat) pts += 7;
  const heatBits: string[] = [];
  if (w?.tanksLast1) heatBits.push("tank last game");
  if ((w?.tanks ?? 0) >= 1) heatBits.push(`${w!.tanks} tanks last 10`);
  if ((w?.brl105 ?? 0) >= 1) heatBits.push(`${w!.brl105}× 105+`);
  if (w?.trendUp) heatBits.push(w.trendDetail.split(" · ")[0] ?? "trend up");
  layers.push({
    key: "heat",
    pass: heat,
    line: heatBits.join(" · ") || "No last-10 heat",
  });

  const parkTrue = (w?.parkTrue ?? 0) >= 3;
  const pullOut = w?.windKind === "pull-out";
  const parkOk = p.park.airIndex >= 108 || parkTrue || pullOut;
  if (parkTrue) pts += 8;
  else if (pullOut) pts += 7;
  else if (p.park.airIndex >= 112) pts += 5;
  if (w?.windKind === "pull-in") pts -= 8;
  layers.push({
    key: "park",
    pass: parkOk,
    line:
      parkTrue && w
        ? `${w.parkTrue}/${w.parkTrueOf} last-10 flies clear ${shortPark(p.park.name)}`
        : pullOut
          ? w?.windLine ?? "pull-side wind out"
          : p.park.airLabel,
  });

  const order = p.battingOrder <= 4;
  if (p.battingOrder <= 2) pts += 8;
  else if (order) pts += 4;
  layers.push({
    key: "order",
    pass: order,
    line: `#${p.battingOrder} · ${p.expectedPa.toFixed(1)} PA vs SP`,
  });

  const dead = w?.cooled === true || w?.softened === true;
  if (dead) pts -= 18;
  layers.push({
    key: "alive",
    pass: !dead,
    line: dead
      ? w?.cooled
        ? `Cooled bat ${w.batDelta != null ? `${w.batDelta.toFixed(1)} vs last 10` : ""}`.trim()
        : `Softened airborne ${w?.airEvDelta != null ? `${w.airEvDelta.toFixed(1)} EV` : ""}`.trim()
      : w?.airborneUp
        ? "Airborne getting louder"
        : "Bat/air holding",
  });

  const score = Math.max(0, Math.min(100, Math.round(pts)));
  const grade: BvpStudy["grade"] =
    both && !dead && order && score >= 60
      ? "best"
      : !dead && mixPass && heat && order && score >= 72
        ? "best"
        : !dead && mixPass && score >= 58
          ? "strong"
          : mixPass || score >= 42
            ? "live"
            : "fade";

  const lead =
    (both
      ? `${both.name} ${both.hitBrl.toFixed(0)}×${both.pitBrl.toFixed(0)} vs ${arm}`
      : hits.length >= 2
        ? `Damages ${Math.round(cover * 100)}% of ${arm}'s card (${hits.slice(0, 2).join(" · ")})`
        : hits[0]
          ? `${hits[0]} vs ${arm}`
          : key?.loud && key.barrelPct != null
            ? `barrels ${arm}'s ${key.name} at ${key.barrelPct.toFixed(0)}% (${Math.round(key.usage * 100)}% mix)`
            : `vs ${arm} — mix is not loud`) +
    (mixHr.n >= 2 ? ` · ${mixHr.n} HR on these types` : "") +
    (lo >= 4 ? ` · ${lo} loud outs` : "") +
    (maxDist >= 400 ? ` · ${Math.round(maxDist)} ft` : "");

  const extra = layers
    .filter((l) => l.pass && l.key !== "mix" && l.key !== "both")
    .slice(0, 3)
    .map((l) => l.line.split(" — ")[0].split(" · ")[0]);
  const line = extra.length ? `${lead} · ${extra.join(" · ")}` : lead;

  return {
    score,
    grade,
    cover,
    headline: `${p.lastName || p.name} vs ${arm}`,
    line,
    layers,
    both20: !!both,
    mixHr: mixHr.n,
  };
}

function mixHrCount(p: PlayerPrediction): { n: number; bits: string[] } {
  const mx = p.pitchMatrix;
  const bits: string[] = [];
  let n = 0;
  if (mx && mx.pitcher.length) {
    for (const row of mx.pitcher) {
      if (row.pct < 0.08) continue;
      const h = mx.hitter.find((x) => x.code === row.code);
      if (h && h.hr > 0) {
        n += h.hr;
        bits.push(`${h.hr} on ${row.name}`);
      }
    }
  } else if ((p.signal.keyMatch?.hr ?? 0) > 0) {
    n = p.signal.keyMatch!.hr;
    bits.push(`${n} on ${p.signal.keyMatch!.name}`);
  }
  return { n, bits };
}

function mixCoverage(p: PlayerPrediction): { cover: number; line: string; hits: string[] } {
  const mx = p.pitchMatrix;
  const key = p.signal.keyMatch;
  const hits: string[] = [];
  let cover = 0;
  if (mx && mx.pitcher.length) {
    for (const row of mx.pitcher) {
      if (row.pct < 0.08) continue;
      const h = mx.hitter.find((x) => x.code === row.code);
      const loud =
        !!h &&
        h.n >= 4 &&
        ((h.barrelPct != null && h.barrelPct >= 12) || (h.iso != null && h.iso >= 0.2));
      if (loud && h) {
        cover += row.pct;
        const two =
          row.barrelPct != null &&
          row.barrelPct >= 18 &&
          h.barrelPct != null &&
          h.barrelPct >= 18;
        const brl = h.barrelPct != null ? `${h.barrelPct.toFixed(0)}% BRL` : `${h.iso?.toFixed(2)} ISO`;
        hits.push(
          two
            ? `${row.name} ${h.barrelPct!.toFixed(0)}×${row.barrelPct!.toFixed(0)} (${Math.round(row.pct * 100)}%)`
            : `${row.name} ${brl} (${Math.round(row.pct * 100)}%)`,
        );
      }
    }
  } else if (key?.loud) {
    cover = key.usage;
    hits.push(
      `${key.name} ${key.barrelPct != null ? `${key.barrelPct.toFixed(0)}% BRL` : "loud"} (${Math.round(key.usage * 100)}%)`,
    );
  }
  const line = hits.length
    ? `Damages ${Math.round(cover * 100)}% of the card · ${hits.join(" · ")}`
    : key
      ? `${key.name} ${Math.round(key.usage * 100)}% mix · ${key.barrelPct == null ? "no sample" : `${key.barrelPct.toFixed(0)}% BRL`} — not a loud match`
      : "No mix card";
  return { cover, line, hits };
}

function lastWord(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}

function shortPark(name: string): string {
  return name.replace(/\s+(Baseball|Ball)?\s*Park$/i, "").replace(/\s+Stadium$/i, "");
}
