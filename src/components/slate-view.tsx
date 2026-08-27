import { useState } from "react";
import { formatGameTime, formatPct, playerHeadshot, teamSpot } from "@/lib/mlb/format";
import type { BoardPayload, GameCard, PlayerPrediction } from "@/lib/mlb/types";
import { cn } from "@/lib/utils";
import { PlayerDetail } from "./player-detail";
import { Badge } from "./ui/badge";

export function SlateView({ board }: { board: BoardPayload }) {
  const [selected, setSelected] = useState<PlayerPrediction | null>(null);

  if (board.games.length === 0) {
    return (
      <div className="rounded-3xl bg-surface px-6 py-16 text-center shadow-hair">
        <p className="font-display text-3xl tracking-tight">No games on the slate.</p>
      </div>
    );
  }

  const hottest = [...board.games].sort((a, b) => b.combinedXhr - a.combinedXhr)[0];

  return (
    <div className="space-y-8">
      <section>
        <p className="text-[11px] font-medium tracking-[0.22em] text-gold uppercase">
          Game slate
        </p>
        <h1 className="mt-1 font-display text-4xl leading-[1.12] sm:text-5xl">
          Parks, arms, and air.
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted">
          Combined expected homers and today's air (park × hand × wind × temp, roof closed when
          posted). A cross breeze L-to-R helps left-handed pull; R-to-L the other way.
          {hottest
            ? ` Tonight that is ${hottest.away.abbr} at ${hottest.home.abbr} (${hottest.combinedXhr.toFixed(1)} xHR · ${hottest.park.airIndex} air).`
            : ""}
        </p>
      </section>

      <div className="space-y-4">
        {board.games.map((game) => (
          <GameBlock
            key={game.gamePk}
            game={game}
            players={board.predictions.filter((p) => p.gamePk === game.gamePk)}
            onOpen={setSelected}
          />
        ))}
      </div>

      <PlayerDetail
        player={selected}
        open={selected != null}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
      />
    </div>
  );
}

function GameBlock({
  game,
  players,
  onOpen,
}: {
  game: GameCard;
  players: PlayerPrediction[];
  onOpen: (p: PlayerPrediction) => void;
}) {
  const away = players.filter((p) => !p.isHome).sort((a, b) => a.battingOrder - b.battingOrder);
  const home = players.filter((p) => p.isHome).sort((a, b) => a.battingOrder - b.battingOrder);
  const top = [...players].sort((a, b) => b.pHr - a.pHr).slice(0, 3);

  return (
    <article className="overflow-hidden rounded-3xl bg-surface shadow-hair">
      <header className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-center gap-3">
          <img src={teamSpot(game.away.id)} alt="" className="size-8" />
          <div>
            <p className="text-sm font-medium">
              {game.away.abbr}
              {game.away.score != null ? (
                <span className="ml-1.5 font-mono tabular-nums text-muted">{game.away.score}</span>
              ) : null}
              <span className="mx-2 text-subtle">@</span>
              {game.home.abbr}
              {game.home.score != null ? (
                <span className="ml-1.5 font-mono tabular-nums text-muted">{game.home.score}</span>
              ) : null}
            </p>
            <p className="text-xs text-muted">
              {formatGameTime(game.gameTime)} ET · {game.venueName}
            {game.park.airLabel ? ` · ${game.park.airLabel}` : ""}
            </p>
          </div>
          <img src={teamSpot(game.home.id)} alt="" className="size-8" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={game.status === "live" ? "live" : game.status === "final" ? "final" : "outline"}>
            {game.statusLabel}
          </Badge>
          <Badge variant={game.park.airIndex >= 108 ? "sage" : "outline"}>
            {game.park.airIndex} air
            {game.park.deltaHr >= 0.15 ? ` · +${game.park.deltaHr.toFixed(1)} HR` : game.park.deltaHr <= -0.15 ? ` · ${game.park.deltaHr.toFixed(1)} HR` : ""}
          </Badge>
          <Badge variant="sage">{game.combinedXhr.toFixed(1)} xHR</Badge>
          {game.lineupSource === "projected" ? <Badge variant="outline">Projected</Badge> : null}
        </div>
      </header>

      <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
        <PitcherLine
          side="Away SP"
          name={game.away.pitcher?.name ?? "TBD"}
          throws={game.away.pitcher?.throws}
          hr9={game.away.pitcher?.hr9}
          mix={game.away.pitcher?.mixLabel}
        />
        <PitcherLine
          side="Home SP"
          name={game.home.pitcher?.name ?? "TBD"}
          throws={game.home.pitcher?.throws}
          hr9={game.home.pitcher?.hr9}
          mix={game.home.pitcher?.mixLabel}
        />
      </div>

      {(game.weather.temp || game.weather.wind || game.weather.condition) && (
        <p className="px-4 pb-3 text-xs text-subtle sm:px-5">
          {[
            game.weather.condition,
            game.weather.temp ? `${game.weather.temp}°F` : null,
            game.weather.wind,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-2">
        <LineupCol team={game.away.abbr} rows={away} onOpen={onOpen} />
        <LineupCol team={game.home.abbr} rows={home} onOpen={onOpen} />
      </div>

      {top.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3 sm:px-5">
          <span className="text-[11px] tracking-wide text-muted uppercase">Best looks</span>
          {top.map((p) => (
            <button
              key={p.playerId}
              type="button"
              onClick={() => onOpen(p)}
              className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-fg transition-colors hover:bg-bg"
            >
              {p.lastName || p.name}{" "}
              <span className="font-mono tabular-nums text-muted">{formatPct(p.pHr, 0)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function PitcherLine({
  side,
  name,
  throws,
  hr9,
  mix,
}: {
  side: string;
  name: string;
  throws?: string;
  hr9?: number | null;
  mix?: string | null;
}) {
  return (
    <p className="text-sm">
      <span className="text-xs tracking-wide text-muted uppercase">{side}</span>
      <span className="mt-0.5 block text-fg">
        {name}
        {throws ? <span className="text-muted"> · {throws}HP</span> : null}
        {hr9 != null ? (
          <span className="font-mono text-muted"> · {hr9.toFixed(2)} HR/9</span>
        ) : null}
        {mix ? <span className="text-muted"> · {mix}</span> : null}
      </span>
    </p>
  );
}

function LineupCol({
  team,
  rows,
  onOpen,
}: {
  team: string;
  rows: PlayerPrediction[];
  onOpen: (p: PlayerPrediction) => void;
}) {
  return (
    <div className="bg-surface px-3 py-3 sm:px-4">
      <p className="mb-2 text-[11px] tracking-wide text-muted uppercase">{team} order</p>
      {rows.length === 0 ? (
        <p className="text-xs text-subtle">Lineup not posted.</p>
      ) : (
        <ol className="space-y-0.5">
          {rows.map((p) => (
            <li key={p.playerId}>
              <button
                type="button"
                onClick={() => onOpen(p)}
                className="flex w-full items-center gap-2 rounded-xl px-1.5 py-1.5 text-left hover:bg-surface-2"
              >
                <span className="w-4 font-mono text-[11px] tabular-nums text-subtle">
                  {p.battingOrder}
                </span>
                <img
                  src={playerHeadshot(p.playerId)}
                  alt=""
                  className="size-6 rounded-full bg-surface-2 object-cover"
                />
                <span className="min-w-0 flex-1 truncate text-sm">{p.lastName || p.name}</span>
                <span
                  className={cn(
                    "font-mono text-xs tabular-nums",
                    p.pHr >= 0.16 ? "text-fg" : "text-muted",
                  )}
                >
                  {formatPct(p.pHr, 0)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
