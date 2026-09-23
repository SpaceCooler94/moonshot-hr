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

### GitHub Actions

| Workflow | When | What |
|---|---|---|
| **CI** | every push / PR | typecheck + model unit tests |
| **Daily slate** | 10:00 ET, or Run workflow | same tests, then fetch the slate and upload it as an artifact |

On GitHub: **Actions → Daily slate → Run workflow**. Download the artifact for that morning’s card.

### Backtest

Season walk-forward is saved under `data/walk/`. The first fill scores completed days in chunks. After that, opening the app **does not re-score** days it already graded. Only new finals (and a model-version change) add work.

Copy `data/walk/` if you move machines.

### Scripts

| Command | What |
|---|---|
| `npm run dev` | Live board |
| `npm run daily` | Headless slate JSON |
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
