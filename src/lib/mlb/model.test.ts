import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pAtLeastOne, pAtLeastTwo, paVsStarter, publishPHr, shrinkRate, STARTER_HR_RATE, TAIL_CUT } from "./prob.ts";
import { isBattedOut, isTank } from "./savant.ts";
import { parseWind, shotClearsPark } from "./parks.ts";
import { findBoth20 } from "./bvp.ts";
import type { PlayerPrediction } from "./types.ts";

describe("shrinkRate", () => {
  it("returns the prior when there are no trials", () => {
    assert.equal(shrinkRate(0, 0, 0.08, 140), 0.08);
  });
  it("pulls a small sample toward the prior", () => {
    const raw = 2 / 20;
    const shrunk = shrinkRate(2, 20, 0.08, 140);
    assert.ok(shrunk < raw);
    assert.ok(shrunk > 0.08);
  });
});

describe("pAtLeastOne", () => {
  it("converts per-PA rate to at-least-one in n PA", () => {
    const p = pAtLeastOne(0.04, 3);
    assert.ok(Math.abs(p - (1 - Math.pow(0.96, 3))) < 1e-9);
  });
});

describe("pAtLeastTwo", () => {
  it("is smaller than P(at least one)", () => {
    const one = pAtLeastOne(0.04, 3);
    const two = pAtLeastTwo(0.04, 3);
    assert.ok(two < one);
    assert.ok(two > 0);
  });
});

describe("publishPHr", () => {
  it("pulls a loud raw toward the starter base", () => {
    const raw = 0.2;
    const published = publishPHr(raw, 0.9);
    assert.ok(published < raw);
    assert.ok(published > STARTER_HR_RATE);
  });
  it("compresses the tail above 16%", () => {
    const hi = publishPHr(0.28, 0.95);
    assert.ok(hi <= 0.22);
    assert.ok(hi > TAIL_CUT);
  });
});

describe("paVsStarter", () => {
  it("gives more PA to the 1-hole than the 9-hole", () => {
    assert.ok(paVsStarter(1, 23) > paVsStarter(9, 23));
  });
});

describe("isTank", () => {
  it("requires 102+ EV, 20–38 launch, and pull", () => {
    assert.equal(isTank(103, 28, true), true);
    assert.equal(isTank(101, 28, true), false);
    assert.equal(isTank(103, 15, true), false);
    assert.equal(isTank(103, 28, false), false);
  });
});

describe("isBattedOut", () => {
  it("counts caught barrels, not doubles", () => {
    assert.equal(isBattedOut("field_out"), true);
    assert.equal(isBattedOut("sac_fly"), true);
    assert.equal(isBattedOut("double"), false);
    assert.equal(isBattedOut("single"), false);
    assert.equal(isBattedOut("home_run"), false);
  });
});

describe("parseWind", () => {
  it("reads pull-side out", () => {
    const w = parseWind("12 mph Out to LF");
    assert.equal(w.dir, "out");
    assert.equal(w.field, "LF");
    assert.equal(w.mph, 12);
  });
});

describe("shotClearsPark", () => {
  it("counts a 320-ft pull at Yankee RF (314)", () => {
    assert.equal(
      shotClearsPark(3313, { dist: 320, spray: 45, ev: 104, la: 28, hr: false }),
      true,
    );
  });
  it("does not count a 320-ft fly at Kauffman (330/410/330)", () => {
    assert.equal(
      shotClearsPark(7, { dist: 320, spray: 0, ev: 100, la: 28, hr: false }),
      false,
    );
  });
});

function stubPlayer(over: Partial<PlayerPrediction> = {}): PlayerPrediction {
  return {
    playerId: 1,
    name: "Test",
    lastName: "Test",
    teamId: 1,
    teamAbbr: "NYY",
    opponentId: 2,
    opponentAbbr: "BOS",
    isHome: true,
    gamePk: 1,
    gameStatus: "preview",
    gameStatusLabel: "Preview",
    gameTime: "",
    battingOrder: 2,
    position: "1B",
    bats: "R",
    pitcher: {
      id: 9,
      name: "Arm",
      throws: "R",
      hr9: 1.5,
      hr: 10,
      bf: 200,
      hardPct: null,
      breakPct: null,
      offPct: null,
      mixFamily: "hard",
      mixLabel: "FB",
      arsenal: null,
      inZone: 48,
      edge: 40,
      kPct: 20,
      whiffPct: null,
      whip: null,
      gs: 10,
      tbfPerStart: 23,
    },
    park: {
      id: 3313,
      name: "Yankee Stadium",
      hrFactor: 116,
      airIndex: 116,
      airLabel: "116 air",
      deltaHr: 16,
      temp: "75",
      wind: null,
      humidity: null,
      dewpoint: null,
    },
    pHr: 0.12,
    pHrRaw: 0.14,
    xHr: 0.3,
    expectedPa: 3,
    pHrPa: 0.04,
    gamePa: 4.4,
    starterTbf: 23,
    confidence: 0.8,
    confidenceBand: "stable",
    confidenceNotes: [],
    reasons: [],
    factors: {
      batter: { value: 1, label: "batter" },
      pitcher: { value: 1, label: "pitcher" },
      park: { value: 1.16, label: "park" },
      platoon: { value: 1.1, label: "platoon" },
      weather: { value: 1, label: "wx" },
      form: { value: 1, label: "form" },
    },
    season: { hr: 20, pa: 400, avg: ".250", slg: ".480", ops: ".800", abPerHr: "20" },
    recent: null,
    actualHr: null,
    statcast: null,
    week: null,
    handSplit: null,
    pitchMatrix: {
      from: "2026-07-01",
      to: "2026-08-29",
      pitcher: [{ code: "FF", name: "4S-FB", n: 20, pct: 0.33, barrelPct: 25, ev: 90, iso: 0.3, woba: 0.4, hr: 3 }],
      hitter: [{ code: "FF", name: "4S-FB", n: 15, pct: 0.27, barrelPct: 22, ev: 94, iso: 0.4, woba: 0.45, hr: 2 }],
    },
    signal: {
      grade: "live",
      passed: 8,
      total: 18,
      score: 8,
      headline: "",
      why: "",
      missing: null,
      keyMatch: null,
      checks: [],
      decision: {
        pass: false,
        score: 0,
        tags: [],
        missing: null,
        push: 0,
        line: "",
        tonight: [],
        bvp: 0,
        bvpGrade: "fade",
        bvpLine: "",
        bvpLayers: [],
        both20: false,
        mixHr: 0,
      },
    },
    forecast: {
      score: 0,
      conf: 0,
      pRaw: 0,
      pContact: 0,
      pMatch: 0,
      pPark: 0,
      pGame: 0,
      p2plus: 0,
      xHr: 0,
      bars: [],
      driver: "",
      secondary: "",
      likes: [],
      risks: [],
    },
    lineupSource: "official",
    weather: { temp: null, wind: null, condition: null, humidity: null, dewpoint: null },
    ...over,
  } as unknown as PlayerPrediction;
}

describe("findBoth20", () => {
  it("flags the Lowe/Leahy shape: both sides ~20% on 15%+ of the card", () => {
    const hit = findBoth20(stubPlayer());
    assert.ok(hit);
    assert.equal(hit!.strict, true);
    assert.equal(hit!.name, "4S-FB");
    assert.ok(hit!.hitBrl >= 20 && hit!.pitBrl >= 20);
  });
  it("does not fire when hitter BRL is 10%", () => {
    const p = stubPlayer();
    p.pitchMatrix!.hitter[0].barrelPct = 10;
    assert.equal(findBoth20(p), null);
  });
});
