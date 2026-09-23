/** L2-regularized logistic regression. Named coefficients, no black box. */

export function sigmoid(z: number): number {
  if (z >= 20) return 1;
  if (z <= -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

export function logit(p: number): number {
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
  return Math.log(q / (1 - q));
}

export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export type Standardizer = { mean: number[]; sd: number[] };

/** Fit mean/sd on training rows. Column 0 (intercept) stays 1. */
export function fitStandardizer(X: number[][]): Standardizer {
  const p = X[0]?.length ?? 0;
  const mean = new Array(p).fill(0);
  const sd = new Array(p).fill(1);
  const n = X.length;
  if (n === 0 || p === 0) return { mean, sd };
  for (const row of X) {
    for (let j = 1; j < p; j++) mean[j] += row[j];
  }
  for (let j = 1; j < p; j++) mean[j] /= n;
  for (const row of X) {
    for (let j = 1; j < p; j++) {
      const d = row[j] - mean[j];
      sd[j] += d * d;
    }
  }
  for (let j = 1; j < p; j++) {
    sd[j] = Math.sqrt(sd[j] / n);
    if (!(sd[j] > 1e-8)) sd[j] = 1;
  }
  mean[0] = 0;
  sd[0] = 1;
  return { mean, sd };
}

export function applyStandardizer(row: number[], s: Standardizer): number[] {
  return row.map((v, j) => (j === 0 ? 1 : (v - s.mean[j]) / s.sd[j]));
}

function invert(m: number[][]): number[][] | null {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    if (Math.abs(a[piv][col]) < 1e-12) return null;
    [a[col], a[piv]] = [a[piv], a[col]];
    const div = a[col][col];
    for (let j = 0; j < 2 * n; j++) a[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col];
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[col][j];
    }
  }
  return a.map((row) => row.slice(n));
}

/**
 * IRLS logistic. λ is L2 on slopes only (intercept free).
 * Returns weights length = n features (col 0 = intercept).
 */
export function fitLogit(X: number[][], y: number[], lambda: number, maxIter = 30): number[] {
  const n = X.length;
  const p = X[0]?.length ?? 0;
  if (n === 0 || p === 0) return [];
  const w = new Array(p).fill(0);
  w[0] = logit(y.reduce((s, v) => s + v, 0) / n);
  for (let iter = 0; iter < maxIter; iter++) {
    const pvec = new Array(n);
    const wdiag = new Array(n);
    for (let i = 0; i < n; i++) {
      const pi = sigmoid(dot(X[i], w));
      pvec[i] = pi;
      wdiag[i] = Math.max(pi * (1 - pi), 1e-6);
    }
    const H = Array.from({ length: p }, () => new Array(p).fill(0));
    const g = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const resid = y[i] - pvec[i];
      for (let j = 0; j < p; j++) {
        g[j] += X[i][j] * resid;
        const xw = X[i][j] * wdiag[i];
        for (let k = 0; k < p; k++) H[j][k] += xw * X[i][k];
      }
    }
    for (let j = 1; j < p; j++) {
      H[j][j] += lambda;
      g[j] -= lambda * w[j];
    }
    const Hi = invert(H);
    if (!Hi) break;
    let step = 0;
    for (let j = 0; j < p; j++) {
      let dw = 0;
      for (let k = 0; k < p; k++) dw += Hi[j][k] * g[k];
      w[j] += dw;
      step += dw * dw;
    }
    if (step < 1e-10) break;
  }
  return w;
}

export function logLoss(ps: number[], y: number[]): number {
  let s = 0;
  for (let i = 0; i < y.length; i++) {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, ps[i]));
    s += y[i] ? -Math.log(p) : -Math.log(1 - p);
  }
  return s / y.length;
}

export function brier(ps: number[], y: number[]): number {
  let s = 0;
  for (let i = 0; i < y.length; i++) {
    const d = ps[i] - y[i];
    s += d * d;
  }
  return s / y.length;
}

export function predictP(X: number[][], w: number[]): number[] {
  return X.map((row) => sigmoid(dot(row, w)));
}
