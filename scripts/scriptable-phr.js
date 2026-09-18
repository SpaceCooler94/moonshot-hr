// Moonshot P(HR) — Scriptable (iOS)
// Research only. P is vs the starter. Pen leftover is not ranked.
//
// Setup
//   1. Scriptable → + → paste this file → name it "Moonshot PHR"
//   2. Home Screen → Scriptable widget → this script
//   3. Optional widget / run parameter:
//        2026-09-17
//        n=12 min=0.12
//        grade=loud night official
//        ui=web          (default in-app: Steamer-lens WebUI)
//        ui=table        (native table instead of WebView)
//
// Run in the app → Steamer-lens WebUI (park-neutral, regress-w,
// recency, platoon, full-game sketch). JSON copied to clipboard.
// Widget stays a compact P(HR) list.
// Board source: GitHub raw daily board JSON.

const RAW_BASE = "https://raw.githubusercontent.com/SpaceCooler94/moonshot-hr/main/data/daily";
const PRIOR_PA = 140;

const DEFAULTS = {
  n: 12,
  min: 0,
  grade: null, // "loud" | "live" | "thin" | "fade"
  night: false,
  official: false,
  ui: "web", // "web" | "table"
};

async function main() {
  const opts = parseOpts();
  const date = opts.date || todayEt();
  const board = await loadBoard(date);
  const decorated = decorate(board);
  const rows = rank(decorated, opts);

  if (config.runsInWidget) {
    Script.setWidget(buildWidget(date, board, rows, opts));
    Script.complete();
    return;
  }

  const payload = {
    date,
    generatedAt: new Date().toISOString(),
    source: `${RAW_BASE}/board-${date}.json`,
    lens: "steamer",
    n: rows.length,
    meanP: board.summary?.meanP ?? null,
    top12MeanP: board.summary?.top12MeanP ?? null,
    names: rows,
  };

  Pasteboard.copy(JSON.stringify(payload, null, 2));
  const saved = await saveLocal(date, payload, rows);

  if (opts.ui === "table") {
    await presentTable(date, board, rows, saved);
  } else {
    await presentWebUI(board, saved);
  }
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
    else if (tok === "official") out.official = true;
    else if (tok.startsWith("n=")) out.n = Math.max(1, Number(tok.slice(2)) || DEFAULTS.n);
    else if (tok.startsWith("min=")) out.min = Number(tok.slice(4)) || 0;
    else if (tok.startsWith("grade=")) out.grade = tok.slice(6).toLowerCase();
    else if (tok.startsWith("ui=")) out.ui = tok.slice(3).toLowerCase() === "table" ? "table" : "web";
    else if (tok === "table") out.ui = "table";
    else if (tok === "web") out.ui = "web";
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

function pct(n) {
  return `${(Number(n) * 100).toFixed(1)}%`;
}

function pAtLeastOne(p, n) {
  if (!n || n <= 0) return 0;
  return 1 - Math.pow(1 - Math.min(0.07, Math.max(0.003, p)), n);
}

function shrinkRate(hits, trials, prior, n0) {
  const t = Number(trials) || 0;
  const h = Number(hits) || 0;
  return (h + prior * n0) / (t + n0);
}

function steamerLens(p, leagueHrPa) {
  const pa = p.season?.pa || 0;
  const hr = p.season?.hr || 0;
  const rawHrPa = pa > 0 ? hr / pa : leagueHrPa;
  const trust = pa / (pa + PRIOR_PA);
  const shrunkHrPa = shrinkRate(hr, pa, leagueHrPa, PRIOR_PA);
  const park = p.factors?.park?.value || 1;
  const platoon = p.factors?.platoon?.value || 1;
  const form = p.factors?.form?.value || 1;
  const batter = p.factors?.batter?.value || 1;
  const pitcherF = p.factors?.pitcher?.value || 1;
  const pHrPa = p.pHrPa || leagueHrPa;
  const starterPa = p.expectedPa || 3;
  const gamePa = p.gamePa || 4.2;
  const neutralRate = pHrPa / Math.max(0.72, park);
  return {
    rawHrPa,
    shrunkHrPa,
    trust,
    park,
    platoon,
    form,
    batter,
    pitcherF,
    recency: form,
    neutralRate,
    neutralP: pAtLeastOne(neutralRate, starterPa),
    fullSketch: pAtLeastOne(pHrPa, gamePa),
    role: starterPa / Math.max(gamePa, starterPa),
  };
}

function decorate(board) {
  const lg = board.league?.hrPa || 0.031;
  const status = new Map((board.games || []).map((g) => [g.gamePk, g]));
  return (board.predictions || []).map((p) => {
    const s = steamerLens(p, lg);
    const g = status.get(p.gamePk);
    return {
      ...p,
      game: g,
      gameStatus: p.gameStatus || g?.status,
      trust: s.trust,
      recency: s.recency,
      platoon: s.platoon,
      parkM: s.park,
      neutralP: s.neutralP,
      fullSketch: s.fullSketch,
      rawHrPa: s.rawHrPa,
      shrunkHrPa: s.shrunkHrPa,
      batterM: s.batter,
      pitcherM: s.pitcherF,
      role: s.role,
    };
  });
}

function rank(list, opts) {
  let out = list.slice();
  if (opts.night) {
    out = out.filter((p) => p.gameStatus !== "live" && p.gameStatus !== "final");
  }
  if (opts.grade) {
    out = out.filter((p) => String(p.signal?.grade || "").toLowerCase() === opts.grade);
  }
  if (opts.official) {
    out = out.filter((p) => p.lineupSource === "official");
  }
  if (opts.min > 0) {
    out = out.filter((p) => p.pHr >= opts.min);
  }
  out.sort((a, b) => b.pHr - a.pHr || (a.battingOrder || 9) - (b.battingOrder || 9));
  return out.slice(0, opts.n).map((p, i) => slimRow(p, i + 1));
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
    neutralP: p.neutralP,
    fullSketch: p.fullSketch,
    trust: p.trust,
    recency: p.recency,
    platoon: p.platoon,
    parkM: p.parkM,
    confidence: p.confidence,
    band: p.confidenceBand,
    grade: p.signal?.grade ?? null,
    headline: p.signal?.headline ?? null,
    pitcher: p.pitcher?.name ?? null,
    throws: p.pitcher?.throws ?? null,
    park: p.park?.name ?? null,
    air: p.park?.airLabel ?? null,
    lineupSource: p.lineupSource ?? null,
    gamePk: p.gamePk,
    gameTime: p.gameTime,
  };
}

async function presentTable(date, board, rows, saved) {
  const table = new UITable();
  table.showSeparators = true;

  const header = new UITableRow();
  header.isHeader = true;
  header.addText(`Moonshot × Steamer  ${date}`);
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
  clip.addText("JSON copied · P vs SP / park-neutral / regress-w");
  table.addRow(clip);

  for (const r of rows) {
    const row = new UITableRow();
    row.height = 56;
    row.cellSpacing = 8;
    const left = row.addText(
      `${r.rank}. ${r.name}`,
      `${r.team} vs ${r.opp}  #${r.order}  ${r.pitcher ?? "TBD"}`,
    );
    left.widthWeight = 58;
    const right = row.addText(
      pct(r.pHr),
      `pn ${pct(r.neutralP)}  w ${Number(r.trust).toFixed(2)}  ${r.grade ?? "—"}`,
    );
    right.rightAligned = true;
    right.widthWeight = 42;
    table.addRow(row);
  }

  await table.present();
}

async function presentWebUI(board, saved) {
  const html = steamerHtml(board, saved);
  const wv = new WebView();
  await wv.loadHTML(html);
  await wv.present(true);
}

function steamerHtml(board, saved) {
  const injected = JSON.stringify(board);
  const note = saved ? `Saved ${saved}` : "JSON is on the Scriptable clipboard";
  return STEAMER_UI.replace("/*INJECT*/null", injected).split("/*SAVED*/").join(note);
}

function buildWidget(date, board, rows, opts) {
  const w = new ListWidget();
  w.backgroundColor = new Color("#0b1220");
  w.setPadding(12, 14, 12, 14);

  const title = w.addText("MOONSHOT × STEAMER");
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
  const foot = w.addText(opts.grade || opts.night || opts.min || opts.official ? filterLabel(opts) : "vs starter · research");
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
  if (opts.official) bits.push("official");
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
    try {
      const fm = FileManager.local();
      const dir = fm.joinPath(fm.documentsDirectory(), "moonshot");
      if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
      const jsonPath = fm.joinPath(dir, `phr-${date}.json`);
      fm.writeString(jsonPath, JSON.stringify(payload, null, 2));
      fm.writeString(fm.joinPath(dir, `phr-${date}.csv`), toCsv(rows));
      return jsonPath;
    } catch (err2) {
      return null;
    }
  }
}

function csvEscape(v) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function toCsv(rows) {
  const cols = [
    "rank", "name", "team", "opp", "order", "bats",
    "pHr", "neutralP", "fullSketch", "trust", "recency", "platoon", "parkM",
    "xHr", "confidence", "band", "grade", "pitcher", "park", "headline",
  ];
  const head = cols.join(",");
  const body = rows.map((r) =>
    cols
      .map((c) => {
        const v = r[c];
        const num = typeof v === "number";
        return csvEscape(num && ["pHr", "neutralP", "fullSketch", "trust", "recency", "platoon", "parkM", "xHr", "confidence"].includes(c)
          ? v.toFixed(4)
          : v);
      })
      .join(","),
  );
  return [head, ...body].join("\n") + "\n";
}

const STEAMER_UI = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Moonshot × Steamer lens</title>
  <style>
    :root {
      --bg: #070b14;
      --card: #101826;
      --line: #1e2a3d;
      --text: #e8eef6;
      --muted: #8b97a8;
      --accent: #7ec8ff;
      --loud: #ff6b6b;
      --live: #ffd166;
      --thin: #8bd0ff;
      --ok: #6ee7b7;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 14px/1.45 -apple-system, system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    header {
      position: sticky; top: 0; z-index: 5;
      background: rgba(7,11,20,.94);
      border-bottom: 1px solid var(--line);
      padding: 12px 14px 10px;
      padding-top: max(12px, env(safe-area-inset-top));
    }
    h1 { font-size: 15px; margin: 0 0 2px; letter-spacing: .04em; }
    .sub { color: var(--muted); font-size: 11px; }
    .row { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 8px; align-items: center; }
    input, select, button {
      background: var(--card);
      color: var(--text);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 7px 9px;
      font: inherit;
    }
    button { cursor: pointer; }
    button.primary { background: #16324d; border-color: #2a5f8a; color: var(--accent); }
    main { padding: 12px 14px 40px; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
    @media (min-width: 900px) { .grid { grid-template-columns: 1fr 300px; } }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 11px;
    }
    .scroller { overflow: auto; -webkit-overflow-scrolling: touch; }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    th, td { text-align: left; padding: 7px 5px; border-bottom: 1px solid var(--line); white-space: nowrap; }
    th { color: var(--muted); font-size: 10px; font-weight: 600; }
    tr.sel td { background: #1b2c44; }
    .grade { font-weight: 700; text-transform: uppercase; font-size: 11px; }
    .g-loud { color: var(--loud); } .g-live { color: var(--live); }
    .g-thin { color: var(--thin); } .g-fade { color: var(--muted); }
    .pct { font-weight: 650; }
    .pill {
      display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 999px;
      border: 1px solid var(--line); color: var(--muted);
    }
    .bars { display: grid; gap: 6px; }
    .bar-lab { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); }
    .track { height: 7px; background: #0b1220; border-radius: 99px; overflow: hidden; }
    .fill { height: 100%; background: var(--accent); }
    .fill.ok { background: var(--ok); }
    .method { color: var(--muted); font-size: 12px; }
    .method p { margin: 6px 0; }
    .tiny { font-size: 11px; color: var(--muted); }
  </style>
</head>
<body>
  <header>
    <h1>MOONSHOT × STEAMER LENS</h1>
    <div class="sub">Scriptable · published P vs starter · research only</div>
    <div class="row">
      <input id="q" placeholder="Search name / team / SP" />
      <select id="grade">
        <option value="">All grades</option>
        <option>loud</option><option>live</option><option>thin</option><option>fade</option>
      </select>
      <label class="tiny"><input type="checkbox" id="night" /> night</label>
      <label class="tiny"><input type="checkbox" id="official" /> official</label>
      <select id="n">
        <option value="12">Top 12</option>
        <option value="20" selected>Top 20</option>
        <option value="40">Top 40</option>
        <option value="999">All</option>
      </select>
    </div>
    <div class="tiny" id="meta" style="margin-top:8px">Loading…</div>
  </header>
  <main>
    <div class="grid">
      <div class="card scroller">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Name</th><th>P vs SP</th><th>Park-n</th>
              <th>Full</th><th>w</th><th>Rec</th><th>Plat</th>
              <th>Park</th><th>Grade</th><th>SP</th>
            </tr>
          </thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>
      <div>
        <div class="card" id="detail"><div class="tiny">Tap a row</div></div>
        <div class="card method" style="margin-top:12px">
          <strong style="color:var(--text)">Wired (no math retune)</strong>
          <p><b>Regress w</b> = PA/(PA+140). <b>Recency</b> = form. <b>Park-neutral</b> strips tonight’s park off pHrPa. <b>Full-game sketch</b> uses gamePa — not the published number.</p>
          <p class="tiny" id="saved"></p>
        </div>
      </div>
    </div>
  </main>
<script>
const PRIOR_PA = 140;
const state = { board: null, rows: [], selected: null };
const BOOT = /*INJECT*/null;

function pct(n) { return (Number(n) * 100).toFixed(1) + "%"; }
function pAtLeastOne(p, n) {
  if (!n || n <= 0) return 0;
  return 1 - Math.pow(1 - Math.min(0.07, Math.max(0.003, p)), n);
}
function shrinkRate(hits, trials, prior, n0) {
  const t = Number(trials) || 0;
  const h = Number(hits) || 0;
  return (h + prior * n0) / (t + n0);
}
function steamerLens(p, leagueHrPa) {
  const pa = p.season?.pa || 0;
  const hr = p.season?.hr || 0;
  const rawHrPa = pa > 0 ? hr / pa : leagueHrPa;
  const trust = pa / (pa + PRIOR_PA);
  const park = p.factors?.park?.value || 1;
  const platoon = p.factors?.platoon?.value || 1;
  const form = p.factors?.form?.value || 1;
  const pHrPa = p.pHrPa || leagueHrPa;
  const starterPa = p.expectedPa || 3;
  const gamePa = p.gamePa || 4.2;
  const neutralRate = pHrPa / Math.max(0.72, park);
  return {
    rawHrPa, trust, park, platoon, form,
    batter: p.factors?.batter?.value || 1,
    pitcher: p.factors?.pitcher?.value || 1,
    recency: form,
    shrunkHrPa: shrinkRate(hr, pa, leagueHrPa, PRIOR_PA),
    neutralP: pAtLeastOne(neutralRate, starterPa),
    fullSketch: pAtLeastOne(pHrPa, gamePa),
  };
}
function decorate(board) {
  const lg = board.league?.hrPa || 0.031;
  return (board.predictions || []).map((p) => {
    const s = steamerLens(p, lg);
    return Object.assign({}, p, s, { parkM: s.park, batterM: s.batter, pitcherM: s.pitcher });
  });
}
function applyFilters(rows) {
  const q = document.getElementById("q").value.trim().toLowerCase();
  const grade = document.getElementById("grade").value;
  const night = document.getElementById("night").checked;
  const official = document.getElementById("official").checked;
  const n = Number(document.getElementById("n").value);
  let out = rows.slice();
  if (q) {
    out = out.filter((p) =>
      [p.name, p.teamAbbr, p.opponentAbbr, p.pitcher && p.pitcher.name, p.park && p.park.name]
        .join(" ").toLowerCase().includes(q),
    );
  }
  if (grade) out = out.filter((p) => ((p.signal && p.signal.grade) || "") === grade);
  if (night) out = out.filter((p) => p.gameStatus !== "live" && p.gameStatus !== "final");
  if (official) out = out.filter((p) => p.lineupSource === "official");
  out.sort((a, b) => (b.pHr || 0) - (a.pHr || 0));
  return out.slice(0, n).map((p, i) => Object.assign({}, p, { rank: i + 1 }));
}
function renderTable(rows) {
  const tb = document.getElementById("tbody");
  tb.innerHTML = rows.map((p) => {
    const g = (p.signal && p.signal.grade) || "fade";
    const sp = (p.pitcher && p.pitcher.name) || "TBD";
    return "<tr data-id='" + p.playerId + ":" + p.gamePk + "'>" +
      "<td>" + p.rank + "</td>" +
      "<td>" + p.name + " <span class='tiny'>" + p.teamAbbr + " vs " + p.opponentAbbr + " #" + p.battingOrder + "</span></td>" +
      "<td class='pct'>" + pct(p.pHr) + "</td>" +
      "<td>" + pct(p.neutralP) + "</td>" +
      "<td>" + pct(p.fullSketch) + "</td>" +
      "<td>" + p.trust.toFixed(2) + "</td>" +
      "<td>" + p.recency.toFixed(2) + "×</td>" +
      "<td>" + p.platoon.toFixed(2) + "×</td>" +
      "<td>" + p.parkM.toFixed(2) + "×</td>" +
      "<td class='grade g-" + g + "'>" + g + "</td>" +
      "<td>" + sp + "</td></tr>";
  }).join("");
  tb.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", () => {
      tb.querySelectorAll("tr").forEach((x) => x.classList.remove("sel"));
      tr.classList.add("sel");
      const row = rows.find((r) => (r.playerId + ":" + r.gamePk) === tr.dataset.id);
      renderDetail(row);
    });
  });
}
function bar(label, value, cut, unit) {
  const v = value == null ? 0 : Number(value);
  const max = Math.max(cut * 1.6, v, 1);
  const pctW = Math.max(0, Math.min(100, (v / max) * 100));
  const ok = value != null && v >= cut;
  const shown = value == null ? "—" : v.toFixed(1) + unit;
  return "<div><div class='bar-lab'><span>" + label + "</span><span>" + shown + " / " + cut + unit +
    "</span></div><div class='track'><div class='fill " + (ok ? "ok" : "") + "' style='width:" + pctW + "%'></div></div></div>";
}
function renderDetail(p) {
  if (!p) return;
  const s = p.statcast || {};
  const w = p.week || {};
  const sig = p.signal || {};
  document.getElementById("detail").innerHTML =
    "<div style='font-weight:700'>" + p.name + "</div>" +
    "<div class='tiny'>" + p.teamAbbr + " vs " + p.opponentAbbr + " · " + ((p.pitcher && p.pitcher.name) || "SP TBD") + " · " + ((p.park && p.park.airLabel) || "") + "</div>" +
    "<div class='row' style='margin:8px 0'>" +
      "<span class='pill'>P vs SP " + pct(p.pHr) + "</span>" +
      "<span class='pill'>park-n " + pct(p.neutralP) + "</span>" +
      "<span class='pill'>full " + pct(p.fullSketch) + "</span>" +
    "</div>" +
    "<div class='tiny'>" + (sig.headline || "") + "</div>" +
    "<p class='tiny'>" + (sig.why || "") + "</p>" +
    "<div class='bars' style='margin-top:10px'>" +
      bar("Season barrels", s.barrel, 12, "%") +
      bar("Week barrels", w.bbe >= 10 ? w.barrelPct : null, 14, "%") +
      bar("Pull air last 10", w.pullAirPct, 18, "%") +
      bar("Fly ball", s.flyBall, 26, "%") +
      bar("EV", s.ev, 91, "") +
      bar("Hard-hit", s.hardHit, 40, "%") +
    "</div>" +
    "<p class='tiny' style='margin-top:10px'>shrink " + p.shrunkHrPa.toFixed(3) + " HR/PA (raw " + p.rawHrPa.toFixed(3) +
      ") · batter " + p.batterM.toFixed(2) + "× · arm " + p.pitcherM.toFixed(2) +
      "× · SP PA " + Number(p.expectedPa || 0).toFixed(1) + " / game " + Number(p.gamePa || 0).toFixed(1) + "</p>";
}
function paint() {
  if (!state.board) return;
  const rows = applyFilters(state.rows);
  renderTable(rows);
  const s = state.board.summary || {};
  document.getElementById("meta").textContent =
    (state.board.date || "") + " · " + (s.games ?? "?") + " games · " +
    (s.modeled ?? rows.length) + " looks · meanP " + pct(s.meanP || 0) +
    " · lock " + ((state.board.lock && state.board.lock.status) || "—");
}
function ingest(board) {
  state.board = board;
  state.rows = decorate(board);
  paint();
}
["q","grade","night","official","n"].forEach((id) => {
  const el = document.getElementById(id);
  el.addEventListener(el.tagName === "INPUT" && el.type !== "checkbox" ? "input" : "change", paint);
});
document.getElementById("saved").textContent = "/*SAVED*/";
if (BOOT && BOOT.predictions) ingest(BOOT);
else document.getElementById("meta").textContent = "No board injected.";
</script>
</body>
</html>
`;

await main();
