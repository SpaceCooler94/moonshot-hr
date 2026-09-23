"use client";

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { formatPct, formatShortDate, playerHeadshot, teamSpot } from "@/lib/mlb/format";
import { gradeLook, lookClass, sortLooks } from "@/lib/mlb/look";
import type { BoardPayload, PlayerPrediction } from "@/lib/mlb/types";
import { cn } from "@/lib/utils";
import { PlayerDetail } from "./player-detail";

export function BoardView({
  board,
  query,
  team,
}: {
  board: BoardPayload;
  query?: string;
  team?: string;
}) {
  const [selected, setSelected] = useState<PlayerPrediction | null>(null);
  const teams = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of board.predictions) {
      if (!map.has(p.teamAbbr)) map.set(p.teamAbbr, p.teamId);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [board.predictions]);

  const pool = useMemo(() => {
    const q = (query ?? "").trim().toLowerCase();
    return board.predictions.filter((p) => {
      if (team && p.teamAbbr !== team) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.teamAbbr.toLowerCase().includes(q) ||
        (p.pitcher?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [board.predictions, query, team]);

  const ranked = useMemo(() => sortLooks(pool), [pool]);
  const looks = ranked.filter((p) => gradeLook(p).call === "look");
  const watches = ranked.filter((p) => gradeLook(p).call === "watch");
  const sits = ranked.filter((p) => gradeLook(p).call === "sit");
  const empty = board.games.length === 0;
  const went = pool.filter((p) => (p.actualHr ?? 0) > 0);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-medium tracking-[0.22em] text-gold uppercase">
          {formatShortDate(board.date)} · research
        </p>
        <h1 className="font-display text-3xl tracking-tight sm:text-4xl">Who to look at.</h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted">
          Calibrated P. LOOK is the tail on the curve. Sit is the default.
        </p>
      </header>

      {went.length > 0 ? (
        <p className="rounded-2xl bg-sage-dim px-4 py-3 text-sm text-sage">
          {went.length} already went yard
          {looks.some((p) => (p.actualHr ?? 0) > 0)
            ? ` · ${went.filter((p) => gradeLook(p).call === "look").length} of them were looks`
            : " · none of them were looks"}
          .
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <SearchRow date={board.date} query={query} team={team} />
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          <FilterChip to="/" date={board.date} query={query} active={!team}>
            All
          </FilterChip>
          {teams.map(([abbr, id]) => (
            <FilterChip key={abbr} to="/" date={board.date} query={query} team={abbr} active={team === abbr}>
              <img src={teamSpot(id)} alt="" className="size-4" />
              {abbr}
            </FilterChip>
          ))}
        </div>
      </div>

      {empty ? (
        <p className="rounded-3xl bg-surface px-4 py-8 text-sm text-muted shadow-hair">
          {board.lock.note?.includes("timed")
            ? "The board is still pulling. Pull down to retry."
            : "No games on this date."}
        </p>
      ) : ranked.length === 0 ? (
        <p className="text-sm text-muted">No batters match that filter.</p>
      ) : (
        <>
          <LookLane title="Look" sub="Calibrated tail" rows={looks} onOpen={setSelected} />
          <LookLane title="Watch" sub="One piece is there" rows={watches} collapsed onOpen={setSelected} />
          <LookLane title="Sit" sub="Default" rows={sits} collapsed onOpen={setSelected} />
        </>
      )}

      <PlayerDetail player={selected} open={selected != null} onOpenChange={(o) => !o && setSelected(null)} date={board.date} />
    </div>
  );
}

function LookLane({
  title,
  sub,
  rows,
  collapsed,
  onOpen,
}: {
  title: string;
  sub: string;
  rows: PlayerPrediction[];
  collapsed?: boolean;
  onOpen: (p: PlayerPrediction) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-medium tracking-[0.22em] text-gold uppercase">{title}</h2>
        <p className="text-xs text-subtle">
          {sub} · {rows.length}
        </p>
      </div>
      {collapsed && rows.length > 8 ? (
        <CollapsedLane title={title} rows={rows} onOpen={onOpen} />
      ) : (
        <div className="overflow-hidden rounded-3xl bg-surface/90 shadow-hair">
          <LaneList rows={rows} onOpen={onOpen} />
        </div>
      )}
    </section>
  );
}

function CollapsedLane({
  title,
  rows,
  onOpen,
}: {
  title: string;
  rows: PlayerPrediction[];
  onOpen: (p: PlayerPrediction) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="overflow-hidden rounded-3xl bg-surface/90 shadow-hair"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer px-4 py-3 text-sm text-muted">
        Show {rows.length} {title.toLowerCase()}
      </summary>
      {open ? <LaneList rows={rows} onOpen={onOpen} /> : null}
    </details>
  );
}

function LaneList({ rows, onOpen }: { rows: PlayerPrediction[]; onOpen: (p: PlayerPrediction) => void }) {
  return (
    <ol className="list-none divide-y divide-border p-0">
      {rows.map((p) => {
        const g = gradeLook(p);
        return (
          <li key={`${p.playerId}:${p.gamePk}`}>
            <button
              type="button"
              onClick={() => onOpen(p)}
              className="flex min-h-14 w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-2 sm:px-4"
            >
              <img
                src={playerHeadshot(p.playerId)}
                alt=""
                className="size-10 shrink-0 rounded-full bg-surface-2 object-cover outline outline-1 -outline-offset-1 outline-fg/10"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-fg">{p.name}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase", lookClass(g.call))}>
                    {g.title}
                  </span>
                  {(p.actualHr ?? 0) > 0 ? (
                    <span className="text-[10px] font-medium tracking-wide text-sage uppercase">{p.actualHr} HR</span>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted">
                  {p.teamAbbr} {p.isHome ? "vs" : "@"} {p.opponentAbbr}
                  {p.pitcher ? ` · ${p.pitcher.name}` : ""} · #{p.battingOrder}
                </span>
                <span className="mt-1 block text-xs leading-snug text-subtle">{g.why}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-sm tabular-nums text-fg">{formatPct(p.pHr)}</span>
                <span className="block text-[10px] tracking-wide text-subtle uppercase">
                  stack {Math.round(g.score * 100)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function SearchRow({ date, query, team }: { date: string; query?: string; team?: string }) {
  return (
    <form method="get" action="/" className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
      <input type="hidden" name="date" value={date} />
      {team ? <input type="hidden" name="team" value={team} /> : null}
      <input
        name="q"
        defaultValue={query ?? ""}
        placeholder="Name, team, pitcher"
        className="h-11 w-full rounded-full border-0 bg-surface pr-4 pl-10 text-sm text-fg shadow-hair outline-none placeholder:text-subtle focus:shadow-hair-strong"
      />
    </form>
  );
}

function FilterChip({
  to,
  date,
  query,
  team,
  active,
  children,
}: {
  to: string;
  date: string;
  query?: string;
  team?: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      search={{ date, q: query, team }}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium",
        active ? "bg-sage-dim text-sage" : "bg-surface text-muted shadow-hair hover:text-fg",
      )}
    >
      {children}
    </Link>
  );
}
