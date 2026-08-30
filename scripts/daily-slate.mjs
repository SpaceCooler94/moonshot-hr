#!/usr/bin/env node
/**
 * Headless daily brief — no Vite, no Grok.
 * Fetches today's MLB slate (ET) and writes data/daily/YYYY-MM-DD.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MLB = "https://statsapi.mlb.com/api/v1";

function todayET() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

async function get(path) {
  const res = await fetch(`${MLB}${path}`, {
    headers: { "User-Agent": "moonshot-hr daily-slate" },
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

const date = process.argv[2] || todayET();
const sched = await get(`/schedule?sportId=1&date=${date}&hydrate=probablePitcher,venue,weather,team`);
const dates = sched.dates ?? [];
const games = [];
for (const d of dates) {
  for (const g of d.games ?? []) {
    const aw = g.teams?.away;
    const hm = g.teams?.home;
    games.push({
      gamePk: g.gamePk,
      time: g.gameDate,
      status: g.status?.detailedState ?? g.status?.abstractGameState,
      venue: g.venue?.name ?? null,
      weather: g.weather ?? null,
      away: {
        id: aw?.team?.id,
        name: aw?.team?.name,
        abbr: aw?.team?.abbreviation ?? aw?.team?.teamName,
        probable: aw?.probablePitcher
          ? { id: aw.probablePitcher.id, name: aw.probablePitcher.fullName }
          : null,
      },
      home: {
        id: hm?.team?.id,
        name: hm?.team?.name,
        abbr: hm?.team?.abbreviation ?? hm?.team?.teamName,
        probable: hm?.probablePitcher
          ? { id: hm.probablePitcher.id, name: hm.probablePitcher.fullName }
          : null,
      },
    });
  }
}

const brief = {
  date,
  generatedAt: new Date().toISOString(),
  games: games.length,
  slate: games,
};

const dir = join(process.cwd(), "data", "daily");
mkdirSync(dir, { recursive: true });
const out = join(dir, `${date}.json`);
writeFileSync(out, JSON.stringify(brief, null, 2));
console.log(`wrote ${out} · ${games.length} games`);
for (const g of games) {
  const ap = g.away.probable?.name ?? "TBD";
  const hp = g.home.probable?.name ?? "TBD";
  console.log(`  ${g.away.name} (${ap}) @ ${g.home.name} (${hp})`);
}
