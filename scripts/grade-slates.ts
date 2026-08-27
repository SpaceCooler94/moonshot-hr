import { loadBoard } from "../src/lib/mlb/board.server";
import { shiftISODate, todayISODateET } from "../src/lib/mlb/format";
import { publishPHr, STARTER_HR_RATE } from "../src/lib/mlb/model";

type Row = {
  date: string;
  pHr: number;
  pHrRaw: number;
  conf: number;
  y: 0 | 1;
  top12: boolean;
};

const today = todayISODateET();
const dates: string[] = [];
for (let i = 1; i <= 8; i++) dates.push(shiftISODate(today, -i));

const rows: Row[] = [];
const perDay: Array<Record<string, unknown>> = [];

for (const date of dates) {
  process.stderr.write(`grading ${date}\n`);
  const board = await loadBoard(date);
  if (board.summary.completedGames === 0 || board.predictions.length === 0) {
    perDay.push({ date, skip: true, games: board.summary.games });
    continue;
  }
  const topIds = new Set(
    board.predictions.slice(0, 12).map((p) => `${p.playerId}:${p.gamePk}`),
  );
  let n = 0;
  for (const p of board.predictions) {
    if (p.actualHr == null) continue;
    n += 1;
    rows.push({
      date,
      pHr: p.pHr,
      pHrRaw: p.pHrRaw,
      conf: p.confidence,
      y: (p.actualHr ?? 0) > 0 ? 1 : 0,
      top12: topIds.has(`${p.playerId}:${p.gamePk}`),
    });
  }
  perDay.push({
    date,
    games: board.summary.completedGames,
    n,
    meanP: board.summary.meanP,
    actualRate: board.summary.actualRate,
    top12Rate: board.summary.top12Rate,
    restRate: board.summary.restRate,
    brier: board.summary.brier,
    top12WithHr: board.summary.top12WithHr,
  });
}

function stats(list: Row[]) {
  const n = list.length;
  if (!n) return { n: 0 };
  const meanP = list.reduce((s, r) => s + r.pHr, 0) / n;
  const actual = list.reduce((s, r) => s + r.y, 0) / n;
  const brier = list.reduce((s, r) => s + (r.pHr - r.y) ** 2, 0) / n;
  return { n, meanP, actual, brier, lift: actual - meanP };
}

const bands = [
  { label: "Under 8%", min: 0, max: 0.08 },
  { label: "8–12%", min: 0.08, max: 0.12 },
  { label: "12–16%", min: 0.12, max: 0.16 },
  { label: "16–20%", min: 0.16, max: 0.2 },
  { label: "20%+", min: 0.2, max: 1.01 },
];

const calib = bands
  .map((b) => {
    const xs = rows.filter((r) => r.pHr >= b.min && r.pHr < b.max);
    return {
      label: b.label,
      n: xs.length,
      meanP: xs.length ? xs.reduce((s, r) => s + r.pHr, 0) / xs.length : 0,
      actual: xs.length ? xs.reduce((s, r) => s + r.y, 0) / xs.length : 0,
    };
  })
  .filter((b) => b.n > 0);

const grid: Array<Record<string, unknown>> = [];
for (const base of [0.1, 0.108, 0.112, 0.116, 0.12]) {
  for (const intercept of [0.32, 0.4, 0.48]) {
    for (const slope of [0.4, 0.5, 0.58]) {
      let brier = 0;
      let meanP = 0;
      let actual = 0;
      for (const r of rows) {
        const trust = intercept + slope * Math.min(0.97, Math.max(0.3, r.conf));
        const p = Math.min(0.28, Math.max(0.028, base + (r.pHrRaw - base) * trust));
        brier += (p - r.y) ** 2;
        meanP += p;
        actual += r.y;
      }
      const n = rows.length || 1;
      grid.push({
        base,
        intercept,
        slope,
        brier: brier / n,
        meanP: meanP / n,
        actual: actual / n,
      });
    }
  }
}
grid.sort((a, b) => Number(a.brier) - Number(b.brier));

const published = rows.map((r) => ({
  ...r,
  pHrPub: publishPHr(r.pHrRaw, r.conf),
}));

console.log(
  JSON.stringify(
    {
      today,
      starterHrRate: STARTER_HR_RATE,
      n: rows.length,
      overall: stats(rows),
      top12: stats(rows.filter((r) => r.top12)),
      rest: stats(rows.filter((r) => !r.top12)),
      calib,
      perDay,
      bestShrink: grid.slice(0, 6),
      currentPublishBrier:
        published.reduce((s, r) => s + (r.pHrPub - r.y) ** 2, 0) / (published.length || 1),
    },
    null,
    2,
  ),
);
