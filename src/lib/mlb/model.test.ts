import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DAMPING, GAME_HR_RATE, pAtLeastOne, pAtLeastTwo, pGameHr, paVsStarter, publishPHr, shrinkRate, shrinkBarrelPct, STARTER_HR_RATE, P_HR_CAP, P_HR_FLOOR, calibInLarge, reliabilityBands } from "./prob.ts";
import { isBattedOut, isTank, pitchCluster, poolByCluster } from "./savant.ts";
import { parseWind, shotClearsPark, sprayOverlapFrom } from "./parks.ts";
import { isISODate, parseWalkDays, pruneMap } from "./http.ts";
import { markBest, readBarrel, readMixHr, readXiso, vsScore } from "./metric-read.ts";
import { studyFromLooks, bookDelta } from "./book-study.ts";
import { findBoth20, cardPitches, givesUp, hrsOnMix, juiceCall, mixIso, mixUniverse } from "./bvp.ts";
import { goingYards } from "./signal.ts";
import { attachLines, bookPlay, deVigOver, evAtPrice, gameHrProb, impliedFromAmerican, inTens, markTickets, normName, pickAnytime, powerJuice, priceTalk, scoreEv } from "./odds.ts";
import { parseSgoEvents } from "./sgo.ts";
import { buildSplits, logsBefore, peelGame, rollWindow } from "./splits.ts";
import { nightRead } from "./brief.ts";
import { paIsTheBet, simPa } from "./sim.ts";
import { parseStuffCsv } from "./stuff.ts";
import { armStatus, buildPen } from "./bullpen.ts";
import type { PlayerPrediction } from "./types.ts";

describe("metric-read", () => {
  it("calls 14% barrels loud and 5% quiet", () => {
    assert.equal(readBarrel(14).tone, "loud");
    assert.equal(readBarrel(5).tone, "quiet");
  });
  it("calls .220 xISO loud and mix HR 0 none", () => {
    assert.equal(readXiso(0.22).tone, "loud");
    assert.match(readMixHr(0).line, /Zero/i);
  });
  it("marks one BEST and skips no-juice", () => {
    const hot = stubPlayer({
      battingOrder: 2,
      lastName: "Tatis",
      season: { hr: 28, pa: 480, avg: ".260", slg: ".520", ops: ".850", abPerHr: "17" },
    });
    hot.ticket = "play";
    hot.signal.decision.pass = true;
    hot.signal.decision.mixHr = 5;
    hot.pitchMatrix = {
      from: "2026-08-01",
      to: "2026-09-01",
      pitcher: [{ code: "SI", name: "Sinker", n: 80, pct: 0.4, barrelPct: 20, ev: 92, iso: 0.28, woba: 0.4, hr: 4, hrPct: 10 }],
      hitter: [{ code: "SI", name: "Sinker", n: 40, pct: 0.3, barrelPct: 20, ev: 94, iso: 0.33, woba: 0.45, hr: 5, hrPct: 16 }],
      pitcherSpray: null,
    };
    const dead = stubPlayer({ battingOrder: 8, lastName: "Machado" });
    dead.playerId = 2;
    dead.season = { hr: 3, pa: 400, avg: ".250", slg: ".360", ops: ".700", abPerHr: "99" };
    const map = markBest([hot, dead]);
    assert.equal(map.get(`${hot.playerId}:${hot.gamePk}`)?.call, "best");
    assert.equal(map.get(`${dead.playerId}:${dead.gamePk}`)?.call, "no");
    assert.ok(vsScore(hot) > vsScore(dead));
  });
});

describe("book-study", () => {
  it("reads a bat's nights and same-mix shape from saved looks", () => {
    const looks = [
      { playerId: 1, y: 1 as const, mix: true, cut: true, pitcherId: 9 },
      { playerId: 1, y: 0 as const, mix: true, cut: true, pitcherId: 8 },
      { playerId: 1, y: 1 as const, mix: false, cut: false, pitcherId: 7 },
      { playerId: 1, y: 0 as const, mix: true, cut: true, pitcherId: 9 },
    ];
    const s = studyFromLooks(looks, 9);
    assert.equal(s.nights, 4);
    assert.equal(s.hits, 2);
    assert.equal(s.mixHits, 1);
    assert.equal(s.vsPitNights, 2);
    assert.equal(s.vsPitHits, 1);
    assert.match(s.line, /2\/4/);
    assert.match(s.line, /this arm/i);
  });
  it("boosts a bat who hits the mix shape in the book", () => {
    const s = studyFromLooks(
      Array.from({ length: 8 }, (_, i) => ({
        playerId: 1,
        y: (i < 3 ? 1 : 0) as 0 | 1,
        mix: true,
        pitcherId: 2,
      })),
      2,
    );
    assert.ok(bookDelta(s) >= 10);
  });
});

describe("splits", () => {
  it("rolls last 3 vs a club like the Tatis/Reds card", () => {
    const rows = [
      { date: "2026-09-01", oppId: 113, hr: 2, ab: 5, pa: 5, h: 2, tb: 8, bb: 0, hbp: 0, sf: 0 },
      { date: "2026-08-31", oppId: 113, hr: 0, ab: 5, pa: 5, h: 1, tb: 2, bb: 0, hbp: 0, sf: 0 },
      { date: "2026-08-30", oppId: 139, hr: 0, ab: 4, pa: 4, h: 0, tb: 0, bb: 0, hbp: 0, sf: 0 },
      { date: "2026-06-10", oppId: 113, hr: 1, ab: 5, pa: 5, h: 2, tb: 5, bb: 0, hbp: 0, sf: 0 },
    ];
    const s = buildSplits(rows, 113, "CIN");
    assert.equal(s.g3.hr, 2);
    assert.equal(s.vsOpp?.g3.hr, 3);
    assert.equal(s.vsOpp?.g3.games, 3);
    assert.equal(s.vsOpp?.season.hr, 3);
    assert.equal(rollWindow(rows, 3).hr, 2);
  });
  it("drops the board date and later games so a grade cannot see tonight", () => {
    const rows = [
      { date: "2026-09-05", oppId: 1, hr: 2, ab: 4, pa: 4, h: 2, tb: 8, bb: 0, hbp: 0, sf: 0 },
      { date: "2026-09-04", oppId: 1, hr: 1, ab: 4, pa: 4, h: 1, tb: 4, bb: 0, hbp: 0, sf: 0 },
      { date: "2026-09-03", oppId: 1, hr: 0, ab: 4, pa: 4, h: 0, tb: 0, bb: 0, hbp: 0, sf: 0 },
    ];
    const prior = logsBefore(rows, "2026-09-04");
    assert.deepEqual(prior.map((r) => r.date), ["2026-09-03"]);
    const peeled = peelGame(20, 400, rows[1]);
    assert.equal(peeled.hr, 19);
    assert.equal(peeled.pa, 396);
  });
});

describe("stuff", () => {
  it("flags a slider 2 mph down vs himself", () => {
    const hdr = "pitch_type,release_speed,release_spin_rate,game_date";
    const base = Array.from({ length: 20 }, () => `SL,86.5,2450,2026-08-20`);
    const rec = Array.from({ length: 10 }, () => `SL,84.0,2450,2026-09-01`);
    const s = parseStuffCsv([hdr, ...base, ...rec].join("\n"), "2026-08-28");
    assert.equal(s?.down, true);
    assert.match(s?.line ?? "", /SL|Slider/i);
  });
});

describe("bullpen", () => {
  it("marks 40 pitches yesterday as down and 85 live as exit", () => {
    assert.equal(armStatus(40, false), "down");
    assert.equal(armStatus(0, false), "up");
    const pen = buildPen({
      starterId: 1,
      starterName: "Joe Starter",
      today: [{ id: 1, name: "Joe Starter", pitches: 92, outs: 18 }],
      yday: [{ id: 2, name: "Reliever", pitches: 12 }],
      live: true,
    });
    assert.equal(pen.likelyExit, true);
    assert.match(pen.line, /pen/i);
  });
});

describe("simPa", () => {
  it("does not fire pregame with a full starter", () => {
    const p = stubPlayer();
    p.signal.decision.mixHr = 3;
    p.ticket = "play";
    assert.equal(paIsTheBet(p), false);
    assert.equal(simPa(p), null);
  });
  it("does not sim a dead mix just because the starter is leaving", () => {
    const p = stubPlayer({ gameStatus: "live" });
    p.pitcher!.likelyExit = true;
    p.pitcher!.starterPitches = 92;
    p.signal.decision.mixHr = 0;
    p.ticket = null;
    assert.equal(simPa(p), null);
  });
  it("cuts the 3-PA number when he's at 92 pitches", () => {
    const p = stubPlayer({ gameStatus: "live", pHrPa: 0.05 });
    p.pitcher!.likelyExit = true;
    p.pitcher!.starterPitches = 92;
    p.signal.decision.mixHr = 3;
    p.ticket = "play";
    const s = simPa(p, 2000);
    assert.ok(s);
    assert.ok(s.p < pAtLeastOne(0.05, 3) - 0.01);
    assert.match(s.line, /pitches/);
    p.paSim = s;
    p.odds = {
      lines: [
        { id: "fd", book: "FanDuel", american: 350, implied: 0, point: 0.5, under: null, fair: null, ev: null },
      ],
      consensus: null,
      fair: null,
      pBet: null,
      ev: null,
      edge: null,
      bestId: "fd",
      ticket: "play",
      why: null,
    };
    assert.equal(priceTalk(p, "best").call, "pass");
  });
});

describe("nightRead", () => {
  it("sits when nobody is a book play", () => {
    const p = stubPlayer();
    p.ticket = null;
    const r = nightRead([p], null, 8, 0);
    assert.equal(r.call, "sit");
  });
  it("names the play in English", () => {
    const p = stubPlayer({
      battingOrder: 2,
      lastName: "Tatis",
      season: { hr: 28, pa: 480, avg: ".260", slg: ".520", ops: ".850", abPerHr: "17" },
    });
    p.signal.decision.pass = true;
    p.signal.decision.mixHr = 3;
    p.ticket = "play";
    const r = nightRead([p], { days: 156, top12Rate: 0.24, restRate: 0.11, cutLooks: 80, cutRate: 0.16 } as never, 8, 0);
    assert.equal(r.call, "play");
    assert.match(r.headline, /Tatis/i);
    assert.match(r.book, /twice/i);
  });
});

describe("http", () => {
  it("accepts ISO dates only", () => {
    assert.equal(isISODate("2026-09-01"), true);
    assert.equal(isISODate("../etc"), false);
    assert.equal(isISODate("2026-9-1"), false);
  });
  it("drops expired cache entries", () => {
    const m = new Map([
      ["a", { exp: 1, val: 1 }],
      ["b", { exp: Date.now() + 10_000, val: 2 }],
    ]);
    pruneMap(m, 80);
    assert.equal(m.has("a"), false);
    assert.equal(m.has("b"), true);
  });
  it("refuses walk JSON that is not an array of days with looks[]", () => {
    assert.deepEqual(parseWalkDays({ date: "2026-09-01", looks: "nope" }), []);
    assert.deepEqual(parseWalkDays("[]"), []);
    assert.equal(
      parseWalkDays([
        { date: "2026-09-01", looks: [{ playerId: 1 }] },
        { date: "../etc/passwd", looks: [{ playerId: 1 }] },
        { date: "2026-09-02", looks: "string" },
      ]).map((d) => d.date).join(","),
      "2026-09-01",
    );
  });
});

describe("brierOf", () => {
  it("uses look count as the denominator", () => {
    const brierOf = (rows: Array<{ pHr: number; y: 0 | 1 }>) =>
      rows.reduce((s, r) => s + (r.pHr - r.y) ** 2, 0) / rows.length;
    assert.equal(brierOf([{ pHr: 0.5, y: 1 }]), 0.25);
    assert.equal(brierOf([{ pHr: 1, y: 1 }, { pHr: 0, y: 0 }]), 0);
  });
});

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

describe("shrinkBarrelPct", () => {
  it("pulls a 20% barrel rate on 40 BBE toward 7.1%", () => {
    const shrunk = shrinkBarrelPct(20, 8, 180, 7.1);
    assert.ok(shrunk < 20);
    assert.ok(shrunk > 7.1);
  });
});

describe("reliabilityBands", () => {
  it("marks n<500 as thin and does not invent a 15 vs 17 call", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ pHr: 0.1, y: (i < 20 ? 1 : 0) as 0 | 1 }));
    const bands = reliabilityBands(rows);
    assert.equal(bands.length, 1);
    assert.equal(bands[0].thin, true);
    assert.equal(bands[0].n, 200);
  });
});

describe("calibInLarge", () => {
  it("flags a 2x over-forecast outside the 95% Poisson-binomial band", () => {
    const rows = Array.from({ length: 400 }, () => ({ pHr: 0.2, y: 0 as 0 | 1 }));
    const c = calibInLarge(rows);
    assert.ok(Math.abs(c.pred - 80) < 1e-6);
    assert.equal(c.actual, 0);
    assert.equal(c.inside95, false);
  });
});

describe("pAtLeastOne", () => {
  it("converts per-PA rate to at-least-one in n PA", () => {
    const p = pAtLeastOne(0.04, 3);
    assert.ok(Math.abs(p - (1 - Math.pow(0.96, 3))) < 1e-9);
  });
});

describe("pGameHr", () => {
  it("is above vs-starter P by leftover PA at league rate", () => {
    const vs = pAtLeastOne(0.031, 3.2);
    const game = pGameHr(0.031, 3.2, 4.2, 0.031);
    assert.ok(game > vs);
    assert.ok(game / vs > 1.2);
    assert.ok(game / vs < 1.4);
  });
  it("equals vs-starter when leftover is 0", () => {
    assert.equal(pGameHr(0.04, 3, 3, 0.04), pAtLeastOne(0.04, 3));
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
  it("pulls a loud raw toward the game base", () => {
    const raw = 0.2;
    const published = publishPHr(raw, 0.9);
    assert.ok(published < raw);
    assert.ok(published > STARTER_HR_RATE);
  });
  it("does not squash a 12-point raw gap into a sub-2-point band", () => {
    const low = publishPHr(0.12, 0.9, 0.11);
    const high = publishPHr(0.24, 0.9, 0.11);
    assert.ok(high - low >= 0.03, `spread ${((high - low) * 100).toFixed(1)} pts`);
    assert.ok(high >= 0.15);
  });
  it("pins the loud tail at the 18% cap instead of printing 25%", () => {
    const raws = [0.1, 0.13, 0.16, 0.19, 0.22, 0.25, 0.28];
    const pubs = raws.map((r) => publishPHr(r, 0.92, 0.11));
    assert.equal(Math.max(...pubs), P_HR_CAP);
    assert.ok(pubs[2]! - pubs[0]! >= 0.02);
    assert.ok(Math.min(...pubs) >= P_HR_FLOOR);
  });
  it("a 12-name stack with real matchup spread does not pin in a sub-1pt band", () => {
    const lg = 0.031;
    const slate = [2.5, 2.2, 2.0, 1.85, 1.7, 1.55, 1.4, 1.28, 1.15, 1.08, 1.0, 0.9];
    const pubs = slate.map((mult, i) => {
      const pPa = Math.min(0.085, Math.max(0.003, lg * Math.pow(mult, DAMPING)));
      const pa = 2.8 - i * 0.05;
      const game = 4.5 - i * 0.08;
      return publishPHr(pGameHr(pPa, pa, game, lg), 0.9, GAME_HR_RATE);
    });
    const band = Math.max(...pubs) - Math.min(...pubs);
    assert.ok(band >= 0.03, `slate band ${((band) * 100).toFixed(1)} pts  max=${pubs[0].toFixed(3)} min=${pubs[11].toFixed(3)}`);
  });
  it("never publishes outside the floor/cap", () => {
    assert.equal(publishPHr(0, 0.3), P_HR_FLOOR);
    assert.equal(publishPHr(0.9, 0.97), P_HR_CAP);
  });
  it("shrinks toward a dead-ball prior, not a fixed 7.7%", () => {
    const dead = publishPHr(0.18, 0.9, 0.06);
    const live = publishPHr(0.18, 0.9, 0.077);
    assert.ok(dead < live);
  });
});

describe("pickAnytime", () => {
  it("takes a 1+ milestone (Over 1) not only 0.5", () => {
    const hit = pickAnytime([
      { name: "Over", description: "Pete Alonso", price: 450, point: 1 },
      { name: "Under", description: "Pete Alonso", price: -650, point: 1 },
    ]);
    assert.equal(hit?.american, 450);
    assert.equal(hit?.point, 1);
  });
  it("prefers 0.5 over a 1.0 milestone and skips 2+", () => {
    const hit = pickAnytime([
      { name: "Over", description: "Judge", price: 380, point: 0.5 },
      { name: "Over", description: "Judge", price: 900, point: 1.5 },
    ]);
    assert.equal(hit?.point, 0.5);
    assert.equal(hit?.american, 380);
  });
});

describe("gameHrProb", () => {
  it("keeps a 12-HR bat near HR/G, not 1-(1-p)^PA at 16%", () => {
    const p = stubPlayer({
      season: { hr: 12, pa: 450, avg: ".260", slg: ".430", ops: ".760", abPerHr: "37" },
      pHrPa: 0.04,
      pHr: 0.16,
    });
    const g = gameHrProb(p);
    assert.ok(g < 0.13, String(g));
    assert.ok(g > 0.07, String(g));
  });
});

describe("evAtPrice", () => {
  it("is zero when P matches plus-money", () => {
    assert.equal(evAtPrice(0.2, 400), 0);
  });
  it("is positive when model P is above the posted implied", () => {
    assert.ok(evAtPrice(0.25, 400) > 0);
  });
});

describe("deVigOver", () => {
  it("splits a two-way +100/+100 market in half", () => {
    assert.equal(deVigOver(100, 100), 0.5);
  });
});

describe("scoreEv", () => {
  it("prices game 1+ HR at the posted FanDuel number", () => {
    const p = stubPlayer({
      name: "Pete Alonso",
      lastName: "Alonso",
      teamAbbr: "NYM",
      pHrPa: 0.05,
      gamePa: 4.4,
      expectedPa: 3.2,
      confidence: 0.9,
      pHr: 0.12,
    });
    p.odds = {
      lines: [
        {
          id: "fd",
          book: "FanDuel",
          american: 450,
          implied: impliedFromAmerican(450),
          point: 0.5,
          under: -700,
          fair: null,
          ev: null,
        },
      ],
      consensus: null,
      fair: null,
      pBet: null,
      ev: null,
      edge: null,
      bestId: null,
      ticket: null,
      why: null,
    };
    scoreEv([p]);
    assert.ok(p.odds?.pBet != null && p.odds.pBet > p.pHr);
    assert.equal(p.odds?.bestId, "fd");
    assert.equal(p.odds?.ticket, null);
  });
  it("does not mark a no-power +4000 as +EV", () => {
    const p = stubPlayer({
      name: "Chandler Simpson",
      lastName: "Simpson",
      season: { hr: 1, pa: 380, avg: ".285", slg: ".360", ops: ".690", abPerHr: null },
      pHrPa: 0.02,
      pHr: 0.07,
      statcast: null,
    });
    p.odds = {
      lines: [
        {
          id: "dk",
          book: "DraftKings",
          american: 4000,
          implied: impliedFromAmerican(4000),
          point: 0.5,
          under: null,
          fair: null,
          ev: null,
        },
      ],
      consensus: null,
      fair: null,
      pBet: null,
      ev: null,
      edge: null,
      bestId: null,
      ticket: null,
      why: null,
    };
    scoreEv([p]);
    assert.equal(powerJuice(p), false);
    assert.equal(p.odds?.ev, null);
  });
  it("plays from the book without needing sportsbooks", () => {
    const p = stubPlayer({
      battingOrder: 2,
      lineupSource: "official",
      confidenceBand: "stable",
      season: { hr: 28, pa: 480, avg: ".260", slg: ".520", ops: ".850", abPerHr: "17" },
      pHrPa: 0.045,
    });
    p.signal.decision.pass = true;
    p.signal.decision.mixHr = 3;
    p.signal.decision.converge = 4;
    p.odds = null;
    markTickets([p]);
    assert.equal(bookPlay(p), true);
    assert.equal(p.ticket, "play");
  });
  it("does not play 9/9 zones with no mix damage", () => {
    const p = stubPlayer({
      battingOrder: 2,
      lineupSource: "official",
      confidenceBand: "stable",
      season: { hr: 28, pa: 480, avg: ".260", slg: ".520", ops: ".850", abPerHr: "17" },
    });
    p.signal.decision.pass = true;
    p.signal.decision.mixHr = 0;
    p.signal.decision.both20 = false;
    p.signal.decision.converge = 9;
    p.odds = null;
    markTickets([p]);
    assert.equal(bookPlay(p), false);
    assert.equal(p.ticket, null);
  });
  it("leans when the Over is long vs a two-way fair", () => {
    const p = stubPlayer({
      battingOrder: 2,
      lineupSource: "official",
      confidenceBand: "stable",
      season: { hr: 22, pa: 470, avg: ".250", slg: ".470", ops: ".800", abPerHr: "21" },
      pHrPa: 0.04,
    });
    p.signal.decision.pass = false;
    p.signal.decision.converge = 1;
    p.signal.decision.yards = false;
    p.signal.decision.both20 = false;
    p.odds = {
      lines: [
        { id: "fd", book: "FanDuel", american: 650, implied: 0, point: 0.5, under: null, fair: null, ev: null },
        { id: "dk", book: "DraftKings", american: 620, implied: 0, point: 0.5, under: null, fair: null, ev: null },
        { id: "pn", book: "Pinnacle", american: 400, implied: 0, point: 0.5, under: -500, fair: null, ev: null },
      ],
      consensus: null,
      fair: null,
      pBet: null,
      ev: null,
      edge: null,
      bestId: null,
      ticket: null,
      why: null,
    };
    scoreEv([p]);
    assert.ok((p.odds?.ev ?? 0) >= 0.08);
    assert.equal(p.odds?.ticket, "lean");
  });
  it("Over EV is fair P at the longest soft price, not model P", () => {
    const p = stubPlayer({
      battingOrder: 2,
      season: { hr: 28, pa: 480, avg: ".260", slg: ".520", ops: ".850", abPerHr: "17" },
    });
    p.odds = {
      lines: [
        { id: "fd", book: "FanDuel", american: 550, implied: 0, point: 0.5, under: -800, fair: null, ev: null },
        { id: "pn", book: "Pinnacle", american: 420, implied: 0, point: 0.5, under: -560, fair: null, ev: null },
      ],
      consensus: null,
      fair: 0.2,
      pBet: null,
      ev: null,
      edge: null,
      bestId: null,
      ticket: null,
      why: null,
    };
    scoreEv([p]);
    const pinFair = p.odds?.lines.find((l) => l.id === "pn")?.fair;
    assert.ok(pinFair != null && pinFair > 0.15 && pinFair < 0.22);
    assert.equal(p.odds?.fair, pinFair);
    assert.ok(p.odds?.ev != null);
    const expectEv = evAtPrice(pinFair!, 550);
    assert.ok(Math.abs((p.odds?.ev ?? 0) - expectEv) < 1e-9);
    assert.ok((p.odds?.ev ?? 0) > 0);
  });
  it("keeps SGO fairOdds when no Under is posted", () => {
    const p = stubPlayer({
      season: { hr: 28, pa: 480, avg: ".260", slg: ".520", ops: ".850", abPerHr: "17" },
    });
    p.odds = {
      lines: [
        { id: "fd", book: "FanDuel", american: 500, implied: 0, point: 0.5, under: null, fair: null, ev: null },
      ],
      consensus: null,
      fair: 0.19,
      pBet: null,
      ev: null,
      edge: null,
      bestId: null,
      ticket: null,
      why: null,
    };
    scoreEv([p]);
    assert.equal(p.odds?.fair, 0.19);
    assert.ok(p.odds?.ev != null);
    assert.ok(Math.abs((p.odds?.ev ?? 0) - evAtPrice(0.19, 500)) < 1e-9);
  });
});

describe("priceTalk", () => {
  it("says PAY when they lay +650 on a 22% shape", () => {
    const p = stubPlayer({
      battingOrder: 2,
      season: { hr: 28, pa: 480, avg: ".260", slg: ".520", ops: ".850", abPerHr: "17" },
    });
    p.signal.decision.both20 = true;
    p.signal.decision.mixHr = 4;
    p.ticket = "play";
    p.odds = {
      lines: [
        { id: "fd", book: "FanDuel", american: 650, implied: 0, point: 0.5, under: null, fair: null, ev: null },
      ],
      consensus: null,
      fair: null,
      pBet: null,
      ev: null,
      edge: null,
      bestId: "fd",
      ticket: "play",
      why: null,
    };
    const t = priceTalk(p, "best");
    assert.equal(t.call, "pay");
    assert.match(t.why, /in 10/);
  });
  it("says PASS when they only pay +240", () => {
    const p = stubPlayer({
      battingOrder: 2,
      season: { hr: 28, pa: 480, avg: ".260", slg: ".520", ops: ".850", abPerHr: "17" },
    });
    p.signal.decision.both20 = true;
    p.signal.decision.mixHr = 4;
    p.ticket = "play";
    p.odds = {
      lines: [
        { id: "fd", book: "FanDuel", american: 240, implied: 0, point: 0.5, under: null, fair: null, ev: null },
      ],
      consensus: null,
      fair: null,
      pBet: null,
      ev: null,
      edge: null,
      bestId: "fd",
      ticket: "play",
      why: null,
    };
    assert.equal(priceTalk(p, "best").call, "pass");
  });
  it("pays when FanDuel is longer than the de-vigged market", () => {
    const p = stubPlayer({
      battingOrder: 2,
      season: { hr: 28, pa: 480, avg: ".260", slg: ".520", ops: ".850", abPerHr: "17" },
    });
    p.signal.decision.both20 = true;
    p.ticket = "play";
    p.odds = {
      lines: [
        { id: "dk", book: "DraftKings", american: 400, implied: 0.2, point: 0.5, under: -520, fair: 0.18, ev: null },
        { id: "fd", book: "FanDuel", american: 650, implied: 0, point: 0.5, under: null, fair: null, ev: null },
      ],
      consensus: null,
      fair: 0.18,
      pBet: null,
      ev: null,
      edge: null,
      bestId: "fd",
      ticket: "play",
      why: null,
    };
    const t = priceTalk(p, "best");
    assert.equal(t.call, "pay");
    assert.match(t.why, /De-vig|in 10/);
  });
  it("passes when FanDuel is shorter than the de-vigged market", () => {
    const p = stubPlayer({ battingOrder: 2 });
    p.signal.decision.both20 = true;
    p.ticket = "play";
    p.odds = {
      lines: [
        { id: "fd", book: "FanDuel", american: 240, implied: impliedFromAmerican(240), point: 0.5, under: -320, fair: 0.22, ev: null },
      ],
      consensus: null,
      fair: 0.22,
      pBet: null,
      ev: null,
      edge: null,
      bestId: "fd",
      ticket: "play",
      why: null,
    };
    assert.equal(priceTalk(p, "best").call, "pass");
  });
  it("does not price a NO", () => {
    const p = stubPlayer();
    p.odds = {
      lines: [
        { id: "fd", book: "FanDuel", american: 2000, implied: 0, point: 0.5, under: null, fair: null, ev: null },
      ],
      consensus: null,
      fair: null,
      pBet: null,
      ev: null,
      edge: null,
      bestId: "fd",
      ticket: null,
      why: null,
    };
    assert.equal(priceTalk(p, "no").call, "sit");
  });
  it("maps 22% to 2 in 10", () => {
    assert.equal(inTens(0.22), 2);
    assert.equal(inTens(0.18), 2);
    assert.equal(inTens(impliedFromAmerican(240)), 3);
  });
});

describe("impliedFromAmerican", () => {
  it("converts plus money to implied percent", () => {
    assert.equal(impliedFromAmerican(400), 0.2);
  });
  it("converts minus money to implied percent", () => {
    assert.ok(Math.abs(impliedFromAmerican(-200) - 2 / 3) < 1e-9);
  });
});

describe("attachLines", () => {
  it("matches FanDuel/DraftKings/Caesars by team and name", () => {
    const p = stubPlayer({ name: "Pete Alonso", lastName: "Alonso", teamAbbr: "NYM" });
    const pack = {
      lines: [
        { id: "fd" as const, book: "FanDuel", american: 450, implied: impliedFromAmerican(450), point: 0.5, under: null, fair: null, ev: null },
        { id: "dk" as const, book: "DraftKings", american: 420, implied: impliedFromAmerican(420), point: 0.5, under: null, fair: null, ev: null },
      ],
      consensus: 0.19,
      fair: null,
      pBet: null,
      ev: null,
      edge: null,
      bestId: null,
      ticket: null,
      why: null,
    };
    const map = new Map([[`NYM:${normName("Pete Alonso")}`, pack]]);
    attachLines([p], map);
    assert.equal(p.odds?.lines[0].book, "FanDuel");
    assert.equal(p.odds?.lines.length, 2);
  });
});

describe("parseSgoEvents", () => {
  it("reads anytime HR yes from FanDuel, DraftKings, and Pinnacle", () => {
    const map = parseSgoEvents(
      [
        {
          status: { startsAt: "2026-09-05T17:10:00.000Z" },
          teams: {
            home: { names: { short: "PHI", long: "Philadelphia Phillies" } },
            away: { names: { short: "ATL", long: "Atlanta Braves" } },
          },
          players: { KYLE_SCHWARBER_1_MLB: { name: "Kyle Schwarber", lastName: "Schwarber" } },
          odds: {
            "batting_homeRuns-KYLE_SCHWARBER_1_MLB-game-yn-yes": {
              statID: "batting_homeRuns",
              statEntityID: "KYLE_SCHWARBER_1_MLB",
              periodID: "game",
              betTypeID: "yn",
              sideID: "yes",
              fairOdds: "+380",
              byBookmaker: {
                fanduel: { odds: "+420", available: true },
                draftkings: { odds: "+400", available: true },
                pinnacle: { odds: "+390", available: true },
                bookmaker: { odds: "+410", available: true },
                bet365: { odds: "+430", available: true },
                caesars: { odds: "+415", available: true },
              },
            },
            "batting_homeRuns-KYLE_SCHWARBER_1_MLB-game-yn-no": {
              statID: "batting_homeRuns",
              statEntityID: "KYLE_SCHWARBER_1_MLB",
              periodID: "game",
              betTypeID: "yn",
              sideID: "no",
              byBookmaker: { fanduel: { odds: "-580", available: true } },
            },
          },
        },
      ],
      "2026-09-05",
    );
    const pack = map.get("PHI:kyle schwarber");
    assert.ok(pack);
    assert.equal(pack.lines.length, 6);
    assert.equal(pack.lines.find((l) => l.id === "pn")?.book, "Pinnacle");
    assert.equal(pack.lines.find((l) => l.id === "be")?.american, 410);
    assert.equal(pack.lines.find((l) => l.id === "b3")?.american, 430);
    assert.equal(pack.lines.find((l) => l.id === "fd")?.american, 420);
    assert.ok(pack.fair != null && pack.fair > 0.15 && pack.fair < 0.25);
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
    assert.equal(isTank(102, 20, true), true);
    assert.equal(isTank(102, 38, true), true);
    assert.equal(isTank(101.9, 28, true), false);
    assert.equal(isTank(102, 19.9, true), false);
    assert.equal(isTank(102, 38.1, true), false);
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
      stuff: null,
      penLine: null,
      likelyExit: false,
      starterPitches: null,
    },
    park: {
      id: 3313,
      name: "Yankee Stadium",
      hrFactor: 116,
      airIndex: 116,
      airLabel: "116 air",
      deltaHr: 16,
      homeHr: 1.31,
      roadHr: 0.7,
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
      pitcher: [{ code: "FF", name: "4S-FB", n: 20, pct: 0.33, barrelPct: 25, ev: 90, iso: 0.3, woba: 0.4, hr: 3, hrPct: 15 }],
      hitter: [{ code: "FF", name: "4S-FB", n: 15, pct: 0.27, barrelPct: 22, ev: 94, iso: 0.4, woba: 0.45, hr: 2, hrPct: 13.3 }],
      pitcherSpray: { lf: 8, cf: 2, rf: 3, n: 13 },
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

describe("sprayOverlap", () => {
  it("flags RHB pull into Yankee LF when the pitcher has allowed LF HRs", () => {
    const s = sprayOverlapFrom({
      bats: "R",
      throws: "L",
      venueId: 3313,
      pullPct: 48,
      pullHr: 3,
      parkTrue: 3,
      windKind: "pull-out",
      windLine: "7 mph out to LF",
      homeHr: 1.31,
      roadHr: 0.7,
      pitcherName: "Jeffrey Springs",
      lfHr: 8,
      rfHr: 2,
    });
    assert.equal(s.pass, true);
    assert.match(s.line, /LF/);
    assert.match(s.line, /1\.31 home/);
  });
});

describe("goingYards", () => {
  it("flags 2 HR in the last-10 window even at 10% P", () => {
    const p = stubPlayer({
      pHr: 0.09,
      week: { nHr: 2, pullHr: 0 } as PlayerPrediction["week"],
    });
    assert.equal(goingYards(p), true);
  });
  it("does not flag a quiet last 10", () => {
    const p = stubPlayer({
      pHr: 0.16,
      week: { nHr: 0, pullHr: 0 } as PlayerPrediction["week"],
      recent: { hr: 1, pa: 40, games: 10 },
    });
    assert.equal(goingYards(p), false);
  });
});

describe("pitchCluster", () => {
  it("does not treat a cutter as a 4-seam or a sweeper as a gyro slider", () => {
    assert.equal(pitchCluster("FF"), "ride");
    assert.equal(pitchCluster("SI"), "sink");
    assert.equal(pitchCluster("FC"), "cut");
    assert.equal(pitchCluster("SL"), "slide");
    assert.equal(pitchCluster("ST"), "sweep");
    assert.equal(pitchCluster("CU"), "curve");
    assert.equal(pitchCluster("CH"), "off");
  });
  it("pools ST + SV as sweeper and does not swallow sliders", () => {
    const sweep = poolByCluster(
      [
        { code: "ST", name: "Sweeper", n: 10, pct: 0.2, barrelPct: 20, ev: 90, iso: 0.3, woba: 0.4, hr: 2, hrPct: 20 },
        { code: "SV", name: "Slurve", n: 6, pct: 0.1, barrelPct: 16, ev: 89, iso: 0.22, woba: 0.36, hr: 1, hrPct: 16.7 },
        { code: "SL", name: "Slider", n: 20, pct: 0.3, barrelPct: 25, ev: 94, iso: 0.4, woba: 0.45, hr: 4, hrPct: 20 },
      ],
      "sweep",
    );
    assert.ok(sweep);
    assert.equal(sweep!.n, 16);
  });
});

describe("findBoth20 cluster", () => {
  it("does not treat a hitter slider as a pitcher sweeper", () => {
    const p = stubPlayer();
    p.pitchMatrix = {
      from: "2026-07-01",
      to: "2026-08-29",
      pitcher: [
        { code: "ST", name: "Sweeper", n: 20, pct: 0.28, barrelPct: 22, ev: 90, iso: 0.3, woba: 0.4, hr: 3, hrPct: 15 },
      ],
      hitter: [
        { code: "SL", name: "Slider", n: 15, pct: 0.22, barrelPct: 21, ev: 93, iso: 0.32, woba: 0.4, hr: 2, hrPct: 13 },
      ],
      pitcherSpray: null,
    };
    assert.equal(findBoth20(p), null);
  });
  it("pools a thin ST sample with SV on the same cluster", () => {
    const p = stubPlayer();
    p.pitchMatrix = {
      from: "2026-07-01",
      to: "2026-08-29",
      pitcher: [
        { code: "ST", name: "Sweeper", n: 20, pct: 0.28, barrelPct: 22, ev: 90, iso: 0.3, woba: 0.4, hr: 3, hrPct: 15 },
      ],
      hitter: [
        { code: "ST", name: "Sweeper", n: 4, pct: 0.08, barrelPct: 10, ev: 88, iso: 0.2, woba: 0.32, hr: 0, hrPct: 0 },
        { code: "SV", name: "Slurve", n: 12, pct: 0.2, barrelPct: 24, ev: 93, iso: 0.35, woba: 0.42, hr: 2, hrPct: 16 },
      ],
      pitcherSpray: null,
    };
    const hit = findBoth20(p);
    assert.ok(hit);
    assert.equal(hit!.code, "ST");
    assert.ok(hit!.hitN >= 12);
  });
});

describe("mixIso", () => {
  it("weights ISO by the pitches on the card", () => {
    const p = stubPlayer();
    p.pitchMatrix = {
      from: "2026-07-01",
      to: "2026-08-29",
      pitcher: [
        { code: "FF", name: "4S", n: 40, pct: 0.4, barrelPct: 10, ev: 90, iso: 0.2, woba: 0.35, hr: 4, hrPct: 10 },
        { code: "SL", name: "SL", n: 30, pct: 0.3, barrelPct: 18, ev: 91, iso: 0.3, woba: 0.4, hr: 5, hrPct: 16 },
        { code: "CH", name: "CH", n: 20, pct: 0.2, barrelPct: 8, ev: 88, iso: 0.1, woba: 0.3, hr: 1, hrPct: 5 },
      ],
      hitter: [
        { code: "FF", name: "4S", n: 20, pct: 0.4, barrelPct: 12, ev: 94, iso: 0.2, woba: 0.38, hr: 2, hrPct: 10 },
        { code: "SL", name: "SL", n: 15, pct: 0.3, barrelPct: 22, ev: 96, iso: 0.4, woba: 0.45, hr: 3, hrPct: 20 },
        { code: "CH", name: "CH", n: 10, pct: 0.2, barrelPct: 6, ev: 88, iso: 0.1, woba: 0.3, hr: 0, hrPct: 0 },
      ],
    };
    const iso = mixIso(p);
    assert.ok(iso != null && iso > 0.22 && iso < 0.28);
    assert.equal(hrsOnMix(p), 5);
    const give = givesUp(p);
    assert.equal(give.byPitch[0].code, "SL");
    assert.equal(give.byPitch[0].hr, 5);
  });
});

describe("juiceCall", () => {
  it("marks 28 HR / 12% barrels as juice", () => {
    const p = stubPlayer({
      season: { hr: 28, pa: 480, avg: ".260", slg: ".520", ops: ".850", abPerHr: "17" },
    });
    assert.equal(juiceCall(p).call, "yes");
  });
  it("marks a contact bat as no juice", () => {
    const p = stubPlayer({
      season: { hr: 3, pa: 400, avg: ".285", slg: ".360", ops: ".690", abPerHr: null },
    });
    assert.equal(juiceCall(p).call, "no");
  });
});

describe("cardPitches", () => {
  it("takes the top 2–3 by usage, not a loud 8% splitter", () => {
    const rows = [
      { code: "FF", pct: 0.42, barrelPct: 9, iso: 0.15 },
      { code: "SL", pct: 0.28, barrelPct: 18, iso: 0.28 },
      { code: "CH", pct: 0.17, barrelPct: 8, iso: 0.12 },
      { code: "FS", pct: 0.08, barrelPct: 40, iso: 0.5 },
    ];
    const card = cardPitches(rows);
    assert.deepEqual(
      card.map((r) => r.code),
      ["FF", "SL", "CH"],
    );
    const uni = mixUniverse(rows);
    assert.equal(uni.some((r) => r.code === "FS"), false);
  });
  it("keeps a 13% hole that gets barreled when it is not top-3 volume", () => {
    const rows = [
      { code: "FF", pct: 0.4, barrelPct: 8, iso: 0.12 },
      { code: "SI", pct: 0.25, barrelPct: 7, iso: 0.1 },
      { code: "CH", pct: 0.18, barrelPct: 6, iso: 0.1 },
      { code: "SL", pct: 0.13, barrelPct: 22, iso: 0.32 },
    ];
    assert.equal(
      cardPitches(rows)
        .map((r) => r.code)
        .includes("SL"),
      false,
    );
    assert.ok(mixUniverse(rows).some((r) => r.code === "SL"));
  });
});
