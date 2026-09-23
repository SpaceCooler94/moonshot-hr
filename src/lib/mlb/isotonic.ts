/** Pool Adjacent Violators — isotonic regression of y on sorted x (raw p). */

export type IsoMap = { x: number[]; y: number[] };

export function fitIsotonic(raw: number[], y: number[]): IsoMap {
  const n = raw.length;
  if (n === 0) return { x: [0, 1], y: [0, 1] };
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => raw[a] - raw[b]);
  const w = new Array(n).fill(1);
  const v = idx.map((i) => y[i]);
  const xv = idx.map((i) => raw[i]);
  let i = 0;
  const blocks: { w: number; v: number; x0: number; x1: number }[] = [];
  for (let k = 0; k < n; k++) {
    blocks.push({ w: w[k], v: v[k], x0: xv[k], x1: xv[k] });
    while (blocks.length >= 2) {
      const a = blocks[blocks.length - 2];
      const b = blocks[blocks.length - 1];
      if (a.v <= b.v) break;
      const nw = a.w + b.w;
      blocks[blocks.length - 2] = {
        w: nw,
        v: (a.v * a.w + b.v * b.w) / nw,
        x0: a.x0,
        x1: b.x1,
      };
      blocks.pop();
    }
  }
  const x: number[] = [];
  const yy: number[] = [];
  for (const b of blocks) {
    x.push(b.x0);
    yy.push(b.v);
    if (b.x1 !== b.x0) {
      x.push(b.x1);
      yy.push(b.v);
    }
  }
  if (x[0] > 0) {
    x.unshift(0);
    yy.unshift(yy[0]);
  }
  if (x[x.length - 1] < 1) {
    x.push(1);
    yy.push(yy[yy.length - 1]);
  }
  void i;
  return { x, y: yy };
}

export function applyIsotonic(p: number, map: IsoMap): number {
  const { x, y } = map;
  if (p <= x[0]) return y[0];
  if (p >= x[x.length - 1]) return y[y.length - 1];
  let lo = 0;
  let hi = x.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= p) lo = mid;
    else hi = mid;
  }
  const t = x[hi] === x[lo] ? 0 : (p - x[lo]) / (x[hi] - x[lo]);
  return y[lo] + t * (y[hi] - y[lo]);
}

export type Decile = { lo: number; hi: number; n: number; meanP: number; actual: number };

export function deciles(ps: number[], y: number[], bins = 10): Decile[] {
  const n = ps.length;
  if (n === 0) return [];
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => ps[a] - ps[b]);
  const out: Decile[] = [];
  for (let d = 0; d < bins; d++) {
    const a = Math.floor((d * n) / bins);
    const b = Math.floor(((d + 1) * n) / bins);
    if (b <= a) continue;
    let sp = 0;
    let sy = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = a; i < b; i++) {
      const p = ps[idx[i]];
      sp += p;
      sy += y[idx[i]];
      if (p < lo) lo = p;
      if (p > hi) hi = p;
    }
    const k = b - a;
    out.push({ lo, hi, n: k, meanP: sp / k, actual: sy / k });
  }
  return out;
}

/** LOOK = lowest p whose upper tail empirical rate ≥ target. */
export function cutFromRate(ps: number[], y: number[], target: number): number {
  const idx = Array.from({ length: ps.length }, (_, i) => i).sort((a, b) => ps[b] - ps[a]);
  let hits = 0;
  let cut = 1;
  for (let k = 0; k < idx.length; k++) {
    hits += y[idx[k]];
    const rate = hits / (k + 1);
    if (rate >= target) cut = ps[idx[k]];
  }
  return cut;
}
