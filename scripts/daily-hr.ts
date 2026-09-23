#!/usr/bin/env node
/** Headless daily HR JSON from the frozen logistic. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadBoard } from "../src/lib/mlb/board.server.ts";
import { readHrArtifact } from "../src/lib/mlb/hr-serve.ts";
import { coeffTable } from "../src/lib/mlb/hr-model.ts";
import { todayISODateET } from "../src/lib/mlb/format.ts";

const date = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : todayISODateET();
const art = readHrArtifact();
if (!art) {
  console.error("no trained model at data/model/current.json — run npm run train");
  process.exit(1);
}
const board = await loadBoard(date);
const out = {
  date: board.date,
  version: art.version,
  generatedAt: new Date().toISOString(),
  cuts: art.cuts,
  lambda: art.lambda,
  metrics: art.metrics,
  coefficients: coeffTable(art),
  batters: board.predictions.map((p) => ({
    id: p.playerId,
    name: p.name,
    team: p.teamAbbr,
    opp: p.opponentAbbr,
    order: p.battingOrder,
    p: p.pHr,
    tier: p.lookCall ?? "sit",
    why: p.lookWhy ?? "",
  })),
};
const dir = join(process.cwd(), "data", "daily");
mkdirSync(dir, { recursive: true });
const path = join(dir, `${board.date}.hr.json`);
writeFileSync(path, JSON.stringify(out, null, 2));
console.log(`${path} n=${out.batters.length} looks=${out.batters.filter((b) => b.tier === "look").length}`);
