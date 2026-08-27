# Moonshot

Daily MLB home-run research board. Public Statcast + MLB Stats API. Research only — no odds, no picks, no stakes.

## Run on your machine (no Grok)

Needs Node 22.

```bash
npm install
npm run dev
```

Open [http://localhost:8080](http://localhost:8080).

That’s it. The board, cards, tanks, and backtest all run locally. Data comes from Baseball Savant and MLB’s public API at request time.

### Backtest

Season walk-forward is saved under `data/walk/`. The first fill scores completed days in chunks. After that, opening the app **does not re-score** days it already graded. Only new final games (and a model-version change) add work.

If you copy this folder to another computer, copy `data/walk/` with it.

### Scripts

| Command | What |
|---|---|
| `npm run dev` | Live board on port 8080 |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript |

Auth and a database are off. Nothing is stored except the local backtest JSON.

## What the board is

- **P(HR) vs the starter** — leftover PA to the bullpen is labeled, not ranked.
- **Tanks last 10** — 102+ mph, 20–38° launch, pulled. Not the same as barrel rate.
- **Matchup matrix** — starter mix × hitter damage on those pitches.
- **Daily air** — park × hand × temp × wind × dewpoint.
- **Walk-forward** — last 5 / last 10 / season vs a season HR/PA × air ranker.
