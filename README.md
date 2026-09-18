# Moonshot

Daily MLB home-run **forecast** board. Public Statcast + MLB Stats API.

Research only — no odds, no vig, no bankroll, no sportsbooks.

## Run on your machine (no Grok)

Needs Node 22.

```bash
npm install
npm run dev
```

Open [http://localhost:8080](http://localhost:8080).

The board, cards, tanks, BvP study, HR forecast, and walk-forward all run locally. Data is fetched from Baseball Savant and MLB’s public API when you open a date.

### Daily brief (no UI)

```bash
npm run daily
```

Writes `data/daily/YYYY-MM-DD.json` — today’s games and probable pitchers (ET). Pass a date: `npm run daily 2026-08-29`.

### Ranked P(HR) names

```bash
npm run phr
npm run phr -- 2026-09-17
npm run phr -- --n 20 --min 0.12 --json
```

Reads `data/daily/board-YYYY-MM-DD.json` and prints names + P vs the starter.

### Steamer-lens WebUI

Static overlay on the published board. Posted `pHr` is unchanged.

- Local: after `npm run dev`, open [http://localhost:8080/moonshot-steamer.html](http://localhost:8080/moonshot-steamer.html)
- File: [`public/moonshot-steamer.html`](public/moonshot-steamer.html)
- Source boards: GitHub raw `data/daily/board-YYYY-MM-DD.json` (or drop a local board JSON on the header)

Columns: P vs SP, park-neutral P, full-game sketch, regression weight `PA/(PA+140)`, recency (`factors.form`), platoon, park. No FanGraphs / Steamer feed is fetched.

### Scriptable (iOS)

[`scripts/scriptable-phr.js`](scripts/scriptable-phr.js) — paste into Scriptable. Widget + table + JSON/CSV on iCloud. Same raw board URL.

### GitHub Actions

| Workflow | When | What |
|---|---|---|
| **CI** | every push / PR | typecheck + model unit tests |
| **Daily slate** | 9:00 ET lock + 4:00 PM ET weather refresh, or Run workflow | tests, then fetch the slate / board and commit `data/daily/` |

On GitHub: **Actions → Daily slate → Run workflow**. Download the artifact for that morning’s card.

### Backtest

Season walk-forward is saved under `data/walk/`. The first fill scores completed days in chunks. After that, opening the app **does not re-score** days it already graded. Only new finals (and a model-version change) add work. Graded P is the locked P when a lock file exists.

Copy `data/walk/` if you move machines.

### Scripts

| Command | What |
|---|---|
| `npm run dev` | Live board |
| `npm run daily` | Headless slate JSON |
| `npm run phr` | Rank P(HR) names from a board file |
| `npm run typecheck` | TypeScript |
| `npm test` | Includes model tests (shrink, tanks, 20×20, fences) |

Auth and a database are off. Nothing is stored except local backtest JSON.

## What the board is

- **P(HR) vs the starter** — leftover PA to the bullpen is labeled, not ranked.
- **Intelligence score (0–100)** — power, arsenal, contact, pitcher, zone, park, PA, form. Does not replace P.
- **Tanks last 10** — 102+ mph, 20–38° launch, pulled. Not the same as barrel rate.
- **20×20** — same pitch, hitter BRL and pitcher allowed BRL both ~20%+.
- **HR on pitch types** — homers in-window on the pitches he throws, not vs that pitcher only.
- **Matchup matrix** — starter mix × hitter damage.
- **Daily air** — park × hand × temp × wind × dewpoint.
- **Walk-forward** — last 5 / last 10 / season, Brier, calibration.
