export type BookLook = {
  playerId: number;
  y: 0 | 1;
  mix?: boolean;
  cut?: boolean;
  both20?: boolean;
  pitcherId?: number;
};

export type BookStudy = {
  nights: number;
  hits: number;
  mixNights: number;
  mixHits: number;
  cutNights: number;
  cutHits: number;
  vsPitNights: number;
  vsPitHits: number;
  line: string;
};

export function emptyStudy(): BookStudy {
  return {
    nights: 0,
    hits: 0,
    mixNights: 0,
    mixHits: 0,
    cutNights: 0,
    cutHits: 0,
    vsPitNights: 0,
    vsPitHits: 0,
    line: "",
  };
}

function rate(hits: number, n: number): number {
  return n > 0 ? hits / n : 0;
}

export function studyFromLooks(looks: BookLook[], pitcherId?: number | null): BookStudy {
  const s = emptyStudy();
  for (const l of looks) {
    s.nights += 1;
    s.hits += l.y;
    if (l.mix) {
      s.mixNights += 1;
      s.mixHits += l.y;
    }
    if (l.cut) {
      s.cutNights += 1;
      s.cutHits += l.y;
    }
    if (pitcherId && l.pitcherId === pitcherId) {
      s.vsPitNights += 1;
      s.vsPitHits += l.y;
    }
  }
  s.line = studyLine(s);
  return s;
}

export function studyLine(s: BookStudy): string {
  if (s.nights < 4) {
    if (s.vsPitNights >= 2) {
      return s.vsPitHits
        ? `Took this arm deep ${s.vsPitHits}/${s.vsPitNights} in the book.`
        : `Faced this arm ${s.vsPitNights} times in the book — no homer.`;
    }
    return "";
  }
  const bits = [`In the book he went yard ${s.hits}/${s.nights} nights.`];
  if (s.mixNights >= 3) {
    bits.push(`Same mix shape: ${s.mixHits}/${s.mixNights}.`);
  }
  if (s.cutNights >= 3) {
    bits.push(`When he was on The Cut: ${s.cutHits}/${s.cutNights}.`);
  }
  if (s.vsPitNights >= 2) {
    bits.push(
      s.vsPitHits
        ? `Vs this arm: ${s.vsPitHits}/${s.vsPitNights}.`
        : `Vs this arm in the book: 0/${s.vsPitNights}.`,
    );
  }
  return bits.join(" ");
}

/** Points the grade adds/subtracts from the saved book. */
export function bookDelta(s: BookStudy | null | undefined): number {
  if (!s || s.nights < 4) {
    if (s && s.vsPitNights >= 2 && s.vsPitHits >= 1) return 10;
    return 0;
  }
  let d = 0;
  const r = rate(s.hits, s.nights);
  if (s.nights >= 8 && r >= 0.2) d += 8;
  else if (s.nights >= 8 && r < 0.07) d -= 8;
  if (s.mixNights >= 4 && rate(s.mixHits, s.mixNights) >= 0.22) d += 12;
  else if (s.mixNights >= 5 && rate(s.mixHits, s.mixNights) < 0.08) d -= 6;
  if (s.vsPitNights >= 2 && s.vsPitHits >= 1) d += 10;
  else if (s.vsPitNights >= 3 && s.vsPitHits === 0) d -= 6;
  return d;
}
