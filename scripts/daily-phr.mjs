#!/usr/bin/env node
/**
 * Rank today's Moonshot board by published P(HR).
 *
 * Reads data/daily/board-YYYY-MM-DD.json (same file Actions commit).
 * Falls back to GitHub raw if the local file is missing.
 *
 *   node scripts/daily-phr.mjs
 *   node scripts/daily-phr.mjs 2026-09-17
 *   node scripts/daily-phr.mjs 2026-09-17 --n 25 --min 0.12
 *   node scripts/daily-phr.mjs --json --csv
 *   node scripts/daily-phr.mjs --grade loud --night
 *
 * Research only. P is vs the starter. Pen leftover is not ranked.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_BASE =
  process.env.MOONSHOT_BOARD_RAW ||
  "https://raw.githubusercontent.com/SpaceCooler94/moonshot-hr/main/data/daily";

function todayEt() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseArgs(argv) {
  const out = { date: null, n: 20, min: 0, json: false, csv: false, grade: null, night: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--n") out.n = Math.max(1, Number(argv[++i]) || 20);
    else if (a === "--min") out.min = Number(argv[++i]) || 0;
    else if (a === "--json") out.json = true;
    else if (a === "--csv") out.csv = true;
    else if (a === "--grade") out.grade = String(argv[++i] || "").toLowerCase();
    else if (a === "--night") out.night = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (!a.startsWith("-") && /^\d{4}-\d{2}-\d{2}$/.test(a)) out.date = a;
    else throw new Error(`unknown arg: ${a}`);
  }
  return out;
}

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function slimRow(p, rank) {
  return {
    rank,
    playerId: p.playerId,
    name: p.name,
    team: p.teamAbbr,
    opp: p.opponentAbbr,
    home: !!p.isHome,
    order: p.battingOrder,
    pos: p.position,
    bats: p.bats,
    pHr: p.pHr,
    xHr: p.xHr,
    confidence: p.confidence,
    band: p.confidenceBand,
    grade: p.signal?.grade ?? null,
    headline: p.signal?.headline ?? null,
    why: p.signal?.why ?? null,
    pitcher: p.pitcher?.name ?? null,
    throws: p.pitcher?.throws ?? null,
    park: p.park?.name ?? null,
    air: p.park?.airLabel ?? null,
    gamePk: p.gamePk,
    gameTime: p.gameTime,
    weather: p.weather ?? null,
  };
}

function csvEscape(v) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function toCsv(rows) {
  const cols = [
    "rank",
    "name",
    "team",
    "opp",
    "order",
    "bats",
    "pHr",
    "xHr",
    "confidence",
    "band",
    "grade",
    "pitcher",
    "throws",
    "park",
    "air",
    "headline",
  ];
  const head = cols.join(",");
  const body = rows.map((r) =>
    cols
      .map((c) => {
        const v = r[c];
        return csvEscape(
          typeof v === "number" && (c === "pHr" || c === "xHr" || c === "confidence")
            ? v.toFixed(4)
            : v,
        );
      })
      .join(","),
  );
  return [head, ...body].join("\n") + "\n";
}

async function loadBoard(date) {
  const local = join(ROOT, "data", "daily", `board-${date}.json`);
  if (existsSync(local)) {
    return { board: JSON.parse(readFileSync(local, "utf8")), source: local };
  }
  const url = `${RAW_BASE}/board-${date}.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`no board for ${date} (${local} missing, ${url} → ${res.status})`);
  }
  return { board: await res.json(), source: url };
}

function gameStatus(board) {
  const map = new Map();
  for (const g of board.games ?? []) map.set(g.gamePk, g.status);
  return map;
}

function filterPreds(board, opts) {
  const status = gameStatus(board);
  let rows = [...(board.predictions ?? [])];
  if (opts.night) {
    rows = rows.filter((p) => status.get(p.gamePk) !== "live" && status.get(p.gamePk) !== "final");
  }
  if (opts.grade) {
    rows = rows.filter((p) => (p.signal?.grade ?? "").toLowerCase() === opts.grade);
  }
  if (opts.min > 0) {
    rows = rows.filter((p) => p.pHr >= opts.min);
  }
  rows.sort((a, b) => b.pHr - a.pHr || a.battingOrder - b.battingOrder);
  return rows.slice(0, opts.n);
}

function printTable(date, source, board, rows, opts) {
  const s = board.summary ?? {};
  console.log(`Moonshot P(HR)  ${date}  model looks ${s.modeled ?? rows.length}  games ${s.games ?? "?"}`);
  console.log(`source ${source}`);
  console.log(
    `slate meanP ${pct(s.meanP ?? 0)}  top12 meanP ${pct(s.top12MeanP ?? 0)}  official LU ${s.officialLineups ?? "?"}  projected ${s.projectedLineups ?? "?"}`,
  );
  if (opts.night) console.log("filter: night/pre-game only (dropped live + final)");
  if (opts.grade) console.log(`filter: grade=${opts.grade}`);
  if (opts.min > 0) console.log(`filter: pHr >= ${pct(opts.min)}`);
  console.log("");
  console.log(
    ["#", "P(HR)", "xHR", "conf", "band", "BO", "name", "tm", "vs", "SP", "park", "grade", "headline"].join("\t"),
  );
  for (const r of rows) {
    console.log(
      [
        r.rank,
        pct(r.pHr),
        r.xHr.toFixed(3),
        r.confidence.toFixed(2),
        r.band,
        r.order,
        r.name,
        r.team,
        r.opp,
        r.pitcher ?? "TBD",
        r.park ?? "",
        r.grade ?? "",
        r.headline ?? "",
      ].join("\t"),
    );
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      `Usage: node scripts/daily-phr.mjs [YYYY-MM-DD] [--n 20] [--min 0.12] [--grade loud] [--night] [--json] [--csv]`,
    );
    return;
  }
  const date = opts.date || todayEt();
  const { board, source } = await loadBoard(date);
  const picked = filterPreds(board, opts);
  const rows = picked.map((p, i) => slimRow(p, i + 1));

  printTable(date, source, board, rows, opts);

  const dir = join(ROOT, "data", "daily");
  mkdirSync(dir, { recursive: true });
  const payload = {
    date,
    generatedAt: new Date().toISOString(),
    source,
    n: rows.length,
    meanP: board.summary?.meanP ?? null,
    top12MeanP: board.summary?.top12MeanP ?? null,
    names: rows,
  };
  const jsonPath = join(dir, `phr-${date}.json`);
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  console.log(`\nwrote ${jsonPath}`);
  if (opts.csv) {
    const csvPath = join(dir, `phr-${date}.csv`);
    writeFileSync(csvPath, toCsv(rows));
    console.log(`wrote ${csvPath}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
