export type PenArm = {
  id: number;
  name: string;
  pitchesYday: number;
  status: "up" | "short" | "down" | "used";
};

export type PenCard = {
  starterPitches: number | null;
  starterOuts: number | null;
  currentId: number | null;
  likelyExit: boolean;
  line: string;
  arms: PenArm[];
};

export type BoxArm = {
  id: number;
  name: string;
  pitches: number;
  outs: number;
};

export function armStatus(pitchesYday: number, usedToday: boolean): PenArm["status"] {
  if (usedToday) return "used";
  if (pitchesYday >= 40) return "down";
  if (pitchesYday >= 15) return "short";
  return "up";
}

export function buildPen(opts: {
  starterId: number | null;
  starterName: string;
  today: BoxArm[];
  yday: Array<{ id: number; name: string; pitches: number }>;
  live: boolean;
}): PenCard {
  const used = new Set(opts.today.map((a) => a.id));
  const current = opts.today[opts.today.length - 1] ?? null;
  const starterToday = opts.today.find((a) => a.id === opts.starterId) ?? null;
  const starterPitches = starterToday?.pitches ?? (opts.live ? current?.pitches ?? null : null);
  const starterOuts = starterToday?.outs ?? null;
  const likelyExit =
    opts.live && ((starterPitches != null && starterPitches >= 85) || (starterOuts != null && starterOuts >= 15));

  const byId = new Map<number, PenArm>();
  for (const y of opts.yday) {
    byId.set(y.id, {
      id: y.id,
      name: y.name,
      pitchesYday: y.pitches,
      status: armStatus(y.pitches, used.has(y.id)),
    });
  }
  for (const t of opts.today) {
    const prev = byId.get(t.id);
    byId.set(t.id, {
      id: t.id,
      name: t.name,
      pitchesYday: prev?.pitchesYday ?? 0,
      status: "used",
    });
  }
  const arms = [...byId.values()].sort((a, b) => {
    const rank = { up: 0, short: 1, down: 2, used: 3 };
    return rank[a.status] - rank[b.status] || a.pitchesYday - b.pitchesYday;
  });

  let line = "Pen looks available.";
  if (likelyExit) {
    line = `${opts.starterName.split(" ").slice(-1)[0]} is at ${starterPitches} pitches. Third look is the pen.`;
  } else if (opts.live && starterPitches != null && starterPitches >= 60) {
    line = `${starterPitches} pitches. Still the starter.`;
  } else {
    const down = arms.filter((a) => a.status === "down").length;
    const up = arms.filter((a) => a.status === "up").length;
    if (down >= 2) line = `${down} arms threw a lot yesterday. Pen is short.`;
    else if (up >= 3) line = "Pen is fresh.";
  }

  return {
    starterPitches,
    starterOuts,
    currentId: current?.id ?? opts.starterId,
    likelyExit,
    line,
    arms: arms.slice(0, 6),
  };
}
