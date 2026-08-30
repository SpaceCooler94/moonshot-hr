#!/usr/bin/env node
/**
 * Headless full HR board — same model as the live site, no Vite/TanStack.
 * Fetches the scored board for a date and writes a slimmed
 * data/daily/board-YYYY-MM-DD.json (drops per-player detail arrays that
 * only the interactive site needs — pitchMatrix, week, statcast, factors,
 * signal.checks/decision — so a day's file stays small enough to commit).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadBoard } from "../src/lib/mlb/board.server";
import { todayISODateET } from "../src/lib/mlb/format";
import type { BoardPayload, GameCard, PlayerPrediction } from "../src/lib/mlb/types";

function slimPrediction(p: PlayerPrediction) {
  return {
    playerId: p.playerId,
    name: p.name,
    teamAbbr: p.teamAbbr,
    opponentAbbr: p.opponentAbbr,
    isHome: p.isHome,
    gamePk: p.gamePk,
    gameTime: p.gameTime,
    battingOrder: p.battingOrder,
    position: p.position,
    bats: p.bats,
    pHr: p.pHr,
    xHr: p.xHr,
    confidence: p.confidence,
    confidenceBand: p.confidenceBand,
    pitcher: p.pitcher ? { name: p.pitcher.name, throws: p.pitcher.throws } : null,
    park: p.park ? { name: p.park.name, airLabel: p.park.airLabel } : null,
    weather: p.weather,
    signal: {
      grade: p.signal.grade,
      headline: p.signal.headline,
      why: p.signal.why,
    },
  };
}

function slimGame(g: GameCard) {
  return {
    gamePk: g.gamePk,
    gameTime: g.gameTime,
    status: g.status,
    statusLabel: g.statusLabel,
    venueName: g.venueName,
    weather: g.weather,
    away: {
      abbr: g.away.abbr,
      name: g.away.name,
      pitcher: g.away.pitcher ? { name: g.away.pitcher.name } : null,
      score: g.away.score,
    },
    home: {
      abbr: g.home.abbr,
      name: g.home.name,
      pitcher: g.home.pitcher ? { name: g.home.pitcher.name } : null,
      score: g.home.score,
    },
  };
}

function slimBoard(board: BoardPayload) {
  return {
    date: board.date,
    season: board.season,
    generatedAt: board.generatedAt,
    summary: board.summary,
    games: board.games.map(slimGame),
    predictions: board.predictions.map(slimPrediction),
  };
}

const date = process.argv[2] || todayISODateET();
const board = await loadBoard(date);
const slim = slimBoard(board);

const dir = join(process.cwd(), "data", "daily");
mkdirSync(dir, { recursive: true });
const out = join(dir, `board-${date}.json`);
writeFileSync(out, JSON.stringify(slim));
console.log(`wrote ${out} · ${slim.predictions.length} predictions across ${slim.games.length} games`);
