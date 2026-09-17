// Moonshot P(HR) — Scriptable (iOS)
// Research only. P is vs the starter. Pen leftover is not ranked.
//
// Setup
//   1. Scriptable → + → paste this file → name it "Moonshot PHR"
//   2. Home Screen → Scriptable widget → this script
//   3. Optional widget parameter:
//        2026-09-17
//        n=12 min=0.12
//        grade=loud night
//
// Run in the app for a table + JSON on the clipboard.
// Board source: GitHub raw daily board JSON.

const RAW_BASE = "https://raw.githubusercontent.com/SpaceCooler94/moonshot-hr/main/data/daily";

const DEFAULTS = {
  n: 12,
  min: 0,
  grade: null, // "loud" | "live" | "thin" | "fade"
  night: false,
};

async function main() {
  const opts = parseOpts();
  const date = opts.date || todayEt();
  const board = await loadBoard(date);
  const rows = rank(board, opts);

  if (config.runsInWidget) {
    Script.setWidget(buildWidget(date, board, rows, opts));
    Script.complete();
    return;
  }

  const payload = {
    date,
    generatedAt: new Date().toISOString(),
    source: `${RAW_BASE}/board-${date}.json`,
    n: rows.length,
    meanP: board.summary?.meanP ?? null,
    top12MeanP: board.summary?.top12MeanP ?? null,
    names: rows,
  };

  Pasteboard.copy(JSON.stringify(payload, null, 2));
  const saved = await saveLocal(date, payload, rows);

  const table = new UITable();
  table.showSeparators = true;
  const header = new UITableRow();
  header.isHeader = true;
  header.addText(`Moonshot P(HR)  ${date}`);
  table.addRow(header);

  const meta = new UITableRow();
  meta.addText(
    `looks ${board.summary?.modeled ?? rows.length} · games ${board.summary?.games ?? "?"} · mean ${pct(board.summary?.meanP ?? 0)}`,
  );
  table.addRow(meta);

  if (saved) {
    const pathRow = new UITableRow();
    pathRow.addText(`saved ${saved}`);
    table.addRow(pathRow);
  }

  const clip = new UITableRow();
  clip.addText("JSON copied to clipboard");
  table.addRow(clip);

  for (const r of rows) {
    const row = new UITableRow();
    row.height = 52;
    row.cellSpacing = 8;
    const left = row.addText(
      `${r.rank}. ${r.name}`,
      `${r.team} vs ${r.opp}  #${r.order}  ${r.pitcher ?? "TBD"}`,
    );
    left.widthWeight = 62;
    const right = row.addText(pct(r.pHr), `${r.grade ?? "—"}  ${r.band ?? ""}`);
    right.rightAligned = true;
    right.widthWeight = 38;
    table.addRow(row);
  }

  await table.present();
  Script.complete();
}

function todayEt() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseOpts() {
  const raw = [args.widgetParameter, ...(args.plainTexts || [])]
    .filter(Boolean)
    .join(" ")
    .trim();
  const out = { ...DEFAULTS, date: null };
  if (!raw) return out;
  for (const tok of raw.split(/\s+/)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(tok)) out.date = tok;
    else if (tok === "night") out.night = true;
    else if (tok.startsWith("n=")) out.n = Math.max(1, Number(tok.slice(2)) || DEFAULTS.n);
    else if (tok.startsWith("min=")) out.min = Number(tok.slice(4)) || 0;
    else if (tok.startsWith("grade=")) out.grade = tok.slice(6).toLowerCase();
  }
  return out;
}

async function loadBoard(date) {
  const req = new Request(`${RAW_BASE}/board-${date}.json`);
  req.timeoutInterval = 20;
  const board = await req.loadJSON();
  if (!board || !Array.isArray(board.predictions)) {
    throw new Error(`No board for ${date}`);
  }
  return board;
}

function rank(board, opts) {
  const status = new Map();
  for (const g of board.games || []) status.set(g.gamePk, g.status);
  let list = [...(board.predictions || [])];
  if (opts.night) {
    list = list.filter((p) => status.get(p.gamePk) !== "live" && status.get(p.gamePk) !== "final");
  }
  if (opts.grade) {
    list = list.filter((p) => String(p.signal?.grade || "").toLowerCase() === opts.grade);
  }
  if (opts.min > 0) {
    list = list.filter((p) => p.pHr >= opts.min);
  }
  list.sort((a, b) => b.pHr - a.pHr || a.battingOrder - b.battingOrder);
  return list.slice(0, opts.n).map((p, i) => ({
    rank: i + 1,
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
    pitcher: p.pitcher?.name ?? null,
    throws: p.pitcher?.throws ?? null,
    park: p.park?.name ?? null,
    air: p.park?.airLabel ?? null,
    gamePk: p.gamePk,
    gameTime: p.gameTime,
  }));
}

function pct(n) {
  return `${(Number(n) * 100).toFixed(1)}%`;
}

function buildWidget(date, board, rows, opts) {
  const w = new ListWidget();
  w.backgroundColor = new Color("#0b1220");
  w.setPadding(12, 14, 12, 14);

  const title = w.addText("MOONSHOT P(HR)");
  title.font = Font.boldSystemFont(11);
  title.textColor = new Color("#8bd0ff");

  const sub = w.addText(`${date}  ·  ${board.summary?.games ?? "?"} g  ·  mean ${pct(board.summary?.meanP ?? 0)}`);
  sub.font = Font.systemFont(10);
  sub.textColor = new Color("#9aa4b2");
  w.addSpacer(8);

  const show = rows.slice(0, config.widgetFamily === "large" ? 12 : config.widgetFamily === "small" ? 4 : 8);
  for (const r of show) {
    const line = w.addStack();
    line.layoutHorizontally();
    const name = line.addText(`${r.rank}  ${r.name}`);
    name.font = Font.mediumSystemFont(12);
    name.textColor = Color.white();
    name.lineLimit = 1;
    line.addSpacer();
    const p = line.addText(pct(r.pHr));
    p.font = Font.mediumSystemFont(12);
    p.textColor = gradeColor(r.grade);
    w.addSpacer(2);
  }

  if (!show.length) {
    const empty = w.addText("No looks for these filters.");
    empty.font = Font.systemFont(12);
    empty.textColor = new Color("#9aa4b2");
  }

  w.addSpacer();
  const foot = w.addText(opts.grade || opts.night || opts.min ? filterLabel(opts) : "vs starter · research");
  foot.font = Font.systemFont(9);
  foot.textColor = new Color("#6b7380");
  return w;
}

function gradeColor(grade) {
  if (grade === "loud") return new Color("#ff6b6b");
  if (grade === "live") return new Color("#ffd166");
  if (grade === "thin") return new Color("#8bd0ff");
  return new Color("#c5cdd6");
}

function filterLabel(opts) {
  const bits = [];
  if (opts.grade) bits.push(opts.grade);
  if (opts.night) bits.push("night");
  if (opts.min > 0) bits.push(`≥${pct(opts.min)}`);
  return bits.join(" · ");
}

async function saveLocal(date, payload, rows) {
  try {
    const fm = FileManager.iCloud();
    const dir = fm.joinPath(fm.documentsDirectory(), "moonshot");
    if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
    const jsonPath = fm.joinPath(dir, `phr-${date}.json`);
    fm.writeString(jsonPath, JSON.stringify(payload, null, 2));
    const csvPath = fm.joinPath(dir, `phr-${date}.csv`);
    fm.writeString(csvPath, toCsv(rows));
    return jsonPath;
  } catch (err) {
    return null;
  }
}

function csvEscape(v) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function toCsv(rows) {
  const cols = ["rank", "name", "team", "opp", "order", "bats", "pHr", "xHr", "confidence", "band", "grade", "pitcher", "park", "headline"];
  const head = cols.join(",");
  const body = rows.map((r) =>
    cols
      .map((c) => {
        const v = r[c];
        const num = typeof v === "number" && (c === "pHr" || c === "xHr" || c === "confidence");
        return csvEscape(num ? v.toFixed(4) : v);
      })
      .join(","),
  );
  return [head, ...body].join("\n") + "\n";
}

await main();
