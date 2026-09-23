import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BARREL_CUT, LOOK_SCORE_CUT, gradeLook, lookScore, sortLooks } from "./look.ts";
import type { PlayerPrediction } from "./types.ts";

function park(air: number, label = "air") {
  return { id: 1, name: "Park", airIndex: air, airLabel: label, homeHr: 1, hrFactor: 1, deltaHr: 0, roadHr: 1, leagueCarry: 1 };
}

function stub(over: Record<string, unknown>): PlayerPrediction {
  return {
    playerId: 1,
    name: "Bat",
    lastName: "Bat",
    teamId: 1,
    teamAbbr: "NYY",
    opponentId: 2,
    opponentAbbr: "BOS",
    isHome: true,
    gamePk: 1,
    gameStatus: "preview",
    battingOrder: 3,
    bats: "R",
    pHr: 0.1,
    park: park(100),
    statcast: { barrel: 8 },
    pitcher: { id: 9, name: "Ace", throws: "R" },
    pitchMatrix: null,
    signal: { keyMatch: null, checks: [], decision: {} },
    ...over,
  } as unknown as PlayerPrediction;
}

describe("lookScore", () => {
  it("puts a loud bat in a plus park above the look cut", () => {
    const s = lookScore({ barrel: 18, key: null, air: 112 });
    assert.ok(s.total >= LOOK_SCORE_CUT, `score ${s.total}`);
  });

  it("keeps a 12% barrel in a dead park under the look cut", () => {
    const s = lookScore({ barrel: 12, key: null, air: 90 });
    assert.ok(s.total < LOOK_SCORE_CUT, `score ${s.total}`);
  });

  it("does not put order in the additive stack", () => {
    const s = lookScore({ barrel: 16, key: null, air: 110 });
    assert.equal("order" in s, false);
    assert.ok(Math.abs(s.power * 0.4 + s.mix * 0.35 + s.park * 0.25 - s.total) < 1e-9);
  });

  it("pays mix more than a quiet unknown mix", () => {
    const quiet = lookScore({ barrel: 14, key: null, air: 100 });
    const loud = lookScore({
      barrel: 14,
      key: { code: "SL", name: "Slider", usage: 0.32, n: 20, barrelPct: 18, ev: 90, iso: 0.28, loud: true, pitBarrelPct: 10, pitN: 40, both20: false, hr: 3 },
      air: 100,
    });
    assert.ok(loud.mix > quiet.mix);
    assert.ok(loud.total > quiet.total);
  });
});

describe("gradeLook", () => {
  it("sits a quiet bat", () => {
    assert.equal(gradeLook(stub({ name: "Contact Guy" })).call, "sit");
  });

  it("looks when power + order + park and the stack clears", () => {
    const g = gradeLook(
      stub({
        name: "Aaron Judge",
        battingOrder: 3,
        statcast: { barrel: 18 },
        park: park(112, "plus"),
      }),
    );
    assert.equal(g.call, "look");
    assert.equal(g.power.on, true);
    assert.equal(g.park.on, true);
  });

  it("watches power without park or mix", () => {
    const g = gradeLook(
      stub({
        name: "Power Bat",
        battingOrder: 3,
        statcast: { barrel: BARREL_CUT },
        park: park(90, "dead"),
      }),
    );
    assert.equal(g.call, "watch");
  });

  it("will not look a 9-hole even with a loud stack", () => {
    const g = gradeLook(
      stub({
        name: "Nine",
        battingOrder: 9,
        statcast: { barrel: 18 },
        park: park(112, "plus"),
      }),
    );
    assert.notEqual(g.call, "look");
    assert.equal(g.order.on, false);
    assert.equal(g.order.weight, 0);
  });

  it("does not look a thin stack even if the lights are on", () => {
    const g = gradeLook(
      stub({
        name: "Barely",
        battingOrder: 6,
        statcast: { barrel: 12 },
        park: park(108, "edge"),
      }),
    );
    assert.notEqual(g.call, "look");
  });

  it("sorts LOOK ahead of SIT", () => {
    const look = stub({
      name: "Loud",
      battingOrder: 2,
      statcast: { barrel: 16 },
      park: park(120, "plus"),
      pHr: 0.14,
    });
    const sit = stub({ name: "Quiet", playerId: 2, statcast: { barrel: 5 }, pHr: 0.06 });
    assert.equal(sortLooks([sit, look])[0]?.name, "Loud");
  });

  it("ranks higher P first among looks", () => {
    const a = stub({
      name: "Lower P",
      battingOrder: 3,
      statcast: { barrel: 18 },
      park: park(112, "plus"),
      pHr: 0.09,
    });
    const b = stub({
      name: "Higher P",
      playerId: 2,
      battingOrder: 3,
      statcast: { barrel: 16 },
      park: park(112, "plus"),
      pHr: 0.15,
    });
    assert.equal(sortLooks([a, b])[0]?.name, "Higher P");
  });
});
