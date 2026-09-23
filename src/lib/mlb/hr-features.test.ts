import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FEATURES, featureRecord, lgDefault, log5, toRow } from "./hr-features.ts";

describe("features", () => {
  it("emits a closed vector with intercept", () => {
    const rec = featureRecord({
      prior: { iso: 0.22, barrel: 14, hardhit: 48, ev: 92, pullair: 22, xiso: 0.21, vsL: 0.04, vsR: 0.03 },
      pitcher: { hr9: 1.4, barrel: 9, fb: 42, ev: 90 },
      logs: Array.from({ length: 10 }, (_, i) => ({ date: `2026-04-${10 + i}`, iso: 0.2, hr: i % 4 === 0 ? 1 : 0, pa: 4, ab: 4 })),
      pitcherLogs: [],
      bats: "R",
      throws: "R",
      venueId: 3313,
      order: 3,
      temp: 78,
      windOut: 6,
      lg: lgDefault(),
    });
    const row = toRow(rec);
    assert.equal(row.length, FEATURES.length + 1);
    assert.equal(row[0], 1);
    assert.ok(rec.exp_pa > 3);
    assert.ok(rec.park > 1);
  });

  it("log5 is between the two rates when league is between", () => {
    const p = log5(0.05, 0.04, 0.032);
    assert.ok(p > 0.032);
    assert.ok(p < 0.08);
  });

  it("rolling shrinks a 1-game 1.000 ISO toward prior", () => {
    const rec = featureRecord({
      prior: { iso: 0.15, barrel: 8, hardhit: 40, ev: 89, pullair: 16, xiso: 0.15, vsL: null, vsR: null },
      pitcher: null,
      logs: [{ date: "2026-04-01", iso: 1, hr: 1, pa: 4, ab: 4 }],
      pitcherLogs: [],
      bats: "L",
      throws: "R",
      venueId: 1,
      order: 1,
      temp: null,
      windOut: null,
      lg: lgDefault(),
    });
    assert.ok(rec.iso_l7 < 0.4, `iso_l7 ${rec.iso_l7}`);
    assert.ok(rec.iso_l7 > 0.15);
  });
});
