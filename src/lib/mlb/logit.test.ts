import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyStandardizer, brier, fitLogit, fitStandardizer, logLoss, predictP, sigmoid } from "./logit.ts";
import { applyIsotonic, cutFromRate, deciles, fitIsotonic } from "./isotonic.ts";

describe("logit", () => {
  it("recovers a known slope on separable-ish data", () => {
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 400; i++) {
      const z = (i / 399) * 4 - 2;
      X.push([1, z]);
      y.push(z > 0 ? 1 : 0);
    }
    const s = fitStandardizer(X);
    const Z = X.map((r) => applyStandardizer(r, s));
    const w = fitLogit(Z, y, 1);
    const ps = predictP(Z, w);
    assert.ok(w[1] > 0, `slope ${w[1]}`);
    assert.ok(brier(ps, y) < 0.12, `brier ${brier(ps, y)}`);
    assert.ok(logLoss(ps, y) < 0.45, `logloss ${logLoss(ps, y)}`);
  });

  it("sigmoid is bounded", () => {
    assert.equal(sigmoid(0), 0.5);
    assert.ok(sigmoid(100) === 1);
    assert.ok(sigmoid(-100) === 0);
  });
});

describe("isotonic", () => {
  it("is non-decreasing and pulls toward observed", () => {
    const raw = [0.1, 0.2, 0.3, 0.4, 0.9, 0.95];
    const y = [0, 0, 0, 1, 1, 1];
    const map = fitIsotonic(raw, y);
    let prev = -1;
    for (const p of raw) {
      const c = applyIsotonic(p, map);
      assert.ok(c >= prev - 1e-9);
      prev = c;
    }
    assert.ok(applyIsotonic(0.95, map) > applyIsotonic(0.1, map));
  });

  it("cutFromRate finds a tail at the target", () => {
    const ps = [0.05, 0.06, 0.08, 0.1, 0.12, 0.2, 0.22, 0.25];
    const y = [0, 0, 0, 0, 0, 1, 1, 1];
    const cut = cutFromRate(ps, y, 0.5);
    assert.ok(cut <= 0.12, `cut ${cut}`);
    assert.ok(cut >= 0.05);
  });

  it("deciles partition n", () => {
    const ps = Array.from({ length: 100 }, (_, i) => i / 100);
    const y = ps.map((p) => (p > 0.7 ? 1 : 0));
    const d = deciles(ps, y, 10);
    assert.equal(d.reduce((s, b) => s + b.n, 0), 100);
  });
});
