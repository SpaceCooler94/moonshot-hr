"use client";

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import {
  formatLockClock,
  formatPct,
  formatShortDate,
  playerHeadshot,
  teamSpot,
  todayISODateET,
} from "@/lib/mlb/format";
import { getWalkForward } from "@/lib/mlb/get-board";
import type {
  BoardPayload,
  ConfidenceBand,
  PlayerPrediction,
  VulnerablePitcher,
  WalkForward,
} from "@/lib/mlb/types";
import { cn } from "@/lib/utils";
import { PlayerDetail } from "./player-detail";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export function BoardView({
  board,
  query,
  team,
  stable,
}: {
  board: BoardPayload;
  query?: string;
  team?: string;
  stable?: boolean;
}) {
  const [selected, setSelected] = useState<PlayerPrediction | null>(null);
  const [walk, setWalk] = useState<WalkForward | null>(board.walkForward);
  const [walkErr, setWalkErr] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setWalkErr(false);
    const pull = () => {
      void getWalkForward({ data: { date: board.date } })
        .then((next) => {
          if (!live) return;
          setWalk(next);
          if (next && next.pending > 0) timer = setTimeout(pull, 1600);
        })
        .catch(() => {
          if (live) setWalkErr(true);
        });
    };
    pull();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [board.date]);
  const boardWithWalk = useMemo(
    () => ({ ...board, walkForward: walk ?? board.walkForward }),
    [board, walk],
  );
  const teams = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of board.predictions) {
      if (!map.has(p.teamAbbr)) map.set(p.teamAbbr, p.teamId);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [board.predictions]);

  const filtered = useMemo(() => {
    const q = (query ?? "").trim().toLowerCase();
    return board.predictions.filter((p) => {
      if (stable && p.confidenceBand !== "stable") return false;
      if (team && p.teamAbbr !== team) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.teamAbbr.toLowerCase().includes(q) ||
        p.opponentAbbr.toLowerCase().includes(q) ||
        (p.pitcher?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [board.predictions, query, team, stable]);

  const top12 = filtered.slice(0, 12);
  const rest = filtered.slice(12);
  const empty = board.games.length === 0;

  return (
    <div className="space-y-8">
      <Hero board={boardWithWalk} walkErr={walkErr} />

      {empty ? (
        <EmptyDate />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <SearchRow date={board.date} query={query} team={team} stable={stable} />
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
              <FilterChip to="/" date={board.date} query={query} active={!team && !stable}>
                All
              </FilterChip>
              <FilterChip
                to="/"
                date={board.date}
                query={query}
                stable
                active={!!stable && !team}
              >
                Stable
              </FilterChip>
              {teams.map(([abbr, id]) => (
                <FilterChip
                  key={abbr}
                  to="/"
                  date={board.date}
                  query={query}
                  team={abbr}
                  stable={stable}
                  active={team === abbr}
                >
                  <img src={teamSpot(id)} alt="" className="size-4" />
                  {abbr}
                </FilterChip>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-muted">No batters match that filter.</p>
          ) : (
            <>
              {top12.length > 0 ? (
                <section>
                  <div className="mb-3 flex items-baseline justify-between">
                    <h2 className="text-[11px] font-medium tracking-[0.22em] text-gold uppercase">
                      Top 12
                    </h2>
                    <p className="text-xs text-subtle">Ranked by P(HR)</p>
                  </div>
                  <div className="overflow-hidden rounded-3xl bg-surface shadow-hair">
                    <div className="hidden items-center gap-3 border-b border-border px-4 py-2 sm:flex">
                      <span className="w-7 shrink-0 text-right text-[11px] font-medium tracking-wide text-subtle uppercase">
                        #
                      </span>
                      <span className="size-10 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 text-[11px] font-medium tracking-wide text-subtle uppercase">
                        Batter
                      </span>
                      <span className="w-12 shrink-0 text-right text-[11px] font-medium tracking-wide text-subtle uppercase">
                        Air
                      </span>
                      <span className="w-12 shrink-0 text-right text-[11px] font-medium tracking-wide text-subtle uppercase">
                        Card
                      </span>
                      <span className="w-[4.5rem] shrink-0 text-right text-[11px] font-medium tracking-wide text-subtle uppercase">
                        P(HR)
                      </span>
                    </div>
                    <ol className="list-none divide-y divide-border p-0">
                      {top12.map((p, i) => (
                        <TopRow
                          key={p.playerId + ":" + p.gamePk}
                          player={p}
                          rank={i + 1}
                          onOpen={() => setSelected(p)}
                        />
                      ))}
                    </ol>
                  </div>
                </section>
              ) : null}

              <VulnerableList
                rows={board.vulnerable ?? []}
                predictions={board.predictions}
                query={query}
                team={team}
                onOpen={setSelected}
              />

              {rest.length > 0 ? (
                <section>
                  <div className="mb-3 flex items-baseline justify-between">
                    <h2 className="text-xs font-medium tracking-[0.14em] text-muted uppercase">
                      Rest of slate
                    </h2>
                    <p className="text-xs text-subtle tabular-nums">{filtered.length} batters</p>
                  </div>
                  <ul className="divide-y divide-border overflow-hidden rounded-3xl bg-surface shadow-hair">
                    {rest.map((p, i) => (
                      <li key={p.playerId + ":" + p.gamePk}>
                        <button
                          type="button"
                          onClick={() => setSelected(p)}
                          className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-2 sm:px-4"
                        >
                          <span className="w-6 shrink-0 text-center font-mono text-xs tabular-nums text-subtle">
                            {i + 13}
                          </span>
                          <img
                            src={playerHeadshot(p.playerId)}
                            alt=""
                            className="size-9 rounded-full bg-surface-2 object-cover outline outline-1 -outline-offset-1 outline-fg/10"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{p.name}</span>
                            <span className="block truncate text-xs text-muted">
                              {p.teamAbbr} {p.isHome ? "vs" : "@"} {p.opponentAbbr}
                              {p.pitcher ? ` · ${p.pitcher.name}` : ""}
                            </span>
                            {p.signal && (p.signal.grade === "loud" || p.signal.grade === "live") ? (
                              <span className="mt-1 block truncate text-[11px] text-muted">
                                <span
                                  className={
                                    p.signal.grade === "loud" ? "text-sage" : "text-gold"
                                  }
                                >
                                  {p.signal.grade}
                                </span>
                                {" · "}
                                {p.signal.keyMatch?.loud && p.signal.keyMatch.barrelPct != null
                                  ? `${p.signal.keyMatch.name} ${p.signal.keyMatch.barrelPct.toFixed(0)}% BRL · ${Math.round(p.signal.keyMatch.usage * 100)}% mix`
                                  : p.signal.headline}
                              </span>
                            ) : null}
                          </span>
                          <span className="hidden w-14 text-right text-xs text-subtle sm:block">
                            {p.park.airIndex} air
                          </span>
                          <ConfidenceMark band={p.confidenceBand} />
                          <span className="w-16 text-right">
                            <span className="block font-mono text-sm tabular-nums text-fg">
                              {formatPct(p.pHr)}
                            </span>
                            <span className="block text-[11px] text-subtle">P(HR)</span>
                          </span>
                          {p.actualHr != null && p.actualHr > 0 ? (
                            <Badge variant="sage">{p.actualHr} HR</Badge>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </>
      )}

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

function Hero({ board, walkErr }: { board: BoardPayload; walkErr?: boolean }) {
  const { summary, lock, walkForward } = board;
  const today = todayISODateET();
  const headline =
    board.date < today ? "Who went yard." : board.date > today ? "Who goes yard." : "Who goes yard today.";
  const lineupNote =
    summary.projectedLineups > 0 && summary.officialLineups === 0
      ? "Projected lineups"
      : summary.projectedLineups > 0
        ? `${summary.officialLineups} official · ${summary.projectedLineups} projected`
        : "Official lineups";
  const last5 = walkForward?.windows.find((w) => w.key === "last5");
  const last10 = walkForward?.windows.find((w) => w.key === "last10");

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-xl">
          <p className="text-[11px] font-medium tracking-[0.22em] text-gold uppercase">
            Home run research
          </p>
          <h1 className="mt-1 font-display text-4xl leading-[1.12] sm:text-5xl">
            {headline}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
            {summary.modeled} starters across {summary.games} games. P(HR) is vs the starter —
            bullpen PA is off this number. Top 12 mean{" "}
            <span className="font-mono tabular-nums text-fg">{formatPct(summary.top12MeanP)}</span>
            {" vs slate "}
            <span className="font-mono tabular-nums text-fg">{formatPct(summary.meanP)}</span>
            . Form stops at yesterday.
            {walkForward && last5 && last10
              ? ` Last 5 days Top 12 ${formatPct(last5.top12Rate, 0)} · last 10 ${formatPct(last10.top12Rate, 0)} · season ${formatPct(walkForward.top12Rate, 0)} vs ${formatPct(walkForward.restRate, 0)} rest.`
              : " P above 16% is pulled back toward the cut."}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-3 lg:min-w-80">
          <HeroStat label="Games" value={String(summary.games)} />
          <HeroStat label="Lineups" value={lineupNote} small />
          <HeroStat
            label={summary.liveGames ? "Live" : summary.completedGames ? "Final" : "Status"}
            value={
              summary.liveGames
                ? `${summary.liveGames} live`
                : summary.completedGames === summary.games && summary.games > 0
                  ? "Final"
                  : "Pre-game"
            }
            small
          />
        </dl>
      </div>

      <LockBanner lock={lock} />

      {summary.top12WithHr != null && (summary.completedGames > 0 || summary.liveGames > 0) ? (
        <div className="rounded-2xl bg-surface px-4 py-3 text-sm shadow-hair">
          <p className="text-[11px] tracking-[0.14em] text-gold uppercase">Research card</p>
          <p className="mt-1 text-fg">
            <span className="font-mono tabular-nums">{summary.top12WithHr}</span> of the top 12
            looks have gone yard
            {summary.top12Rate != null && summary.restRate != null
              ? ` · ${formatPct(summary.top12Rate, 0)} vs ${formatPct(summary.restRate, 0)} rest of slate`
              : ""}
            {summary.actualRate != null
              ? ` · slate ${formatPct(summary.actualRate, 0)} actual vs ${formatPct(summary.meanP, 0)} mean P`
              : ""}
            {summary.actualHrLeaders[0]
              ? ` · ${summary.actualHrLeaders[0].name} leads with ${summary.actualHrLeaders[0].actualHr}`
              : ""}
            .
            {summary.brier != null ? (
              <>
                {" "}
                Brier{" "}
                <span className="font-mono tabular-nums">{summary.brier.toFixed(3)}</span>
                <span className="text-subtle"> · lower is sharper</span>
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      {walkForward ? (
        <WalkCard walk={walkForward} />
      ) : (
        <div className="rounded-2xl bg-surface px-4 py-3 text-sm text-muted shadow-hair">
          {walkErr
            ? "Backtest could not score. Refresh and try again."
            : "Backtest · scoring from Opening Day…"}
        </div>
      )}

      {summary.calibration.length > 0 ? (
        <CalibTable
          title="This slate · predicted vs actual"
          rows={summary.calibration}
        />
      ) : null}
    </section>
  );
}

function LockBanner({ lock }: { lock: BoardPayload["lock"] }) {
  const label =
    lock.status === "locked" && lock.at
      ? `Locked · ${formatLockClock(lock.at)} ET`
      : lock.status === "rebuilt"
        ? "Rebuilt · no lock that night"
        : "Open · P can still move";
  return (
    <div className="rounded-2xl bg-surface px-4 py-3 shadow-hair">
      <p
        className={cn(
          "text-[11px] tracking-[0.14em] uppercase",
          lock.status === "locked" ? "text-gold" : "text-muted",
        )}
      >
        {label}
      </p>
      <p className="mt-1 text-sm text-muted">{lock.note}</p>
    </div>
  );
}

function WalkCard({ walk }: { walk: NonNullable<BoardPayload["walkForward"]> }) {
  const liftSign = walk.lift >= 0 ? "+" : "";
  return (
    <div className="overflow-hidden rounded-2xl bg-surface shadow-hair">
      <div className="px-4 pt-3 pb-3">
        <p className="text-[11px] tracking-[0.14em] text-gold uppercase">
          Backtest · {walk.days}
          {walk.totalDays ? `/${walk.totalDays}` : ""} days · {formatShortDate(walk.from)} –{" "}
          {formatShortDate(walk.to)}
          {walk.pending > 0 ? ` · ${walk.pending} left · saving as we go` : " · saved"}
        </p>
        {walk.windows.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-xs">
              <thead>
                <tr className="text-[11px] tracking-wide text-subtle uppercase">
                  <th className="pb-2 font-medium">Window</th>
                  <th className="pb-2 text-right font-medium">Model T12</th>
                  <th className="pb-2 text-right font-medium">vs rest</th>
                  <th className="pb-2 text-right font-medium">Lift</th>
                  <th className="pb-2 text-right font-medium">Season × air</th>
                  <th className="pb-2 text-right font-medium">L5 games</th>
                  <th className="pb-2 text-right font-medium">L10 games</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {walk.windows.map((w) => (
                  <tr key={w.key} className="text-fg">
                    <td className="py-2 pr-3">
                      {w.label}
                      <span className="mt-0.5 block text-[11px] text-subtle">
                        {w.days}d · {formatShortDate(w.from)}–{formatShortDate(w.to)}
                      </span>
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {w.top12Hits}/{w.top12Looks}
                      <span className="block text-muted">{formatPct(w.top12Rate, 0)}</span>
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-muted">
                      {formatPct(w.restRate, 0)}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {w.lift >= 0 ? "+" : ""}
                      {(w.lift * 100).toFixed(0)}
                      <span className="block text-[11px] text-subtle">
                        {(w.liftLo * 100).toFixed(0)}–{(w.liftHi * 100).toFixed(0)}
                      </span>
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-muted">
                      {formatPct(w.baselineRate, 0)}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-muted">
                      {formatPct(w.last5Rate, 0)}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-muted">
                      {formatPct(w.last10Rate, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="mt-3 text-sm text-fg">
          Season Top 12{" "}
          <span className="font-mono tabular-nums">
            {walk.top12Hits}/{walk.top12Looks}
          </span>{" "}
          ({formatPct(walk.top12Rate, 0)}) vs {formatPct(walk.restRate, 0)} rest
          {" · lift "}
          <span className="font-mono tabular-nums">
            {liftSign}
            {(walk.lift * 100).toFixed(0)} pts
          </span>
          <span className="text-subtle">
            {" "}
            · 95% {(walk.liftLo * 100).toFixed(0)} to {(walk.liftHi * 100).toFixed(0)}
          </span>
        </p>
        <p className="mt-1 text-xs text-muted">
          L5/L10 games rank last 5 or 10 prior games’ HR, not the last 5/10 slates. Season × air
          is HR/PA × park. 16%+ {formatPct(walk.cut16Rate, 0)} hit ({walk.cut16N}) vs under{" "}
          {formatPct(walk.below16Rate, 0)}. Skill{" "}
          <span className="font-mono tabular-nums">{walk.skill.toFixed(3)}</span>
          {" · Brier "}
          <span className="font-mono tabular-nums">{walk.brier.toFixed(3)}</span>
          {" · "}
          {walk.lockedDays} locked · {walk.rebuiltDays} rebuilt
        </p>
        {walk.bestDays.length > 0 && walk.worstDays.length > 0 ? (
          <p className="mt-1 text-xs text-muted">
            Best {walk.bestDays.map((d) => `${formatShortDate(d.date)} ${d.top12WithHr ?? 0}/12`).join(" · ")}
            {" · worst "}
            {walk.worstDays.map((d) => `${formatShortDate(d.date)} ${d.top12WithHr ?? 0}/12`).join(" · ")}
          </p>
        ) : null}
      </div>
      {walk.calibration.length > 0 ? (
        <CalibTable title="Season · predicted vs actual" rows={walk.calibration} nested />
      ) : null}
      <ul className="max-h-72 divide-y divide-border overflow-y-auto border-t border-border">
        {walk.byDay.map((d) => (
          <li key={d.date}>
            <Link
              to="/"
              search={{ date: d.date }}
              className="flex min-h-11 items-center gap-3 px-4 py-3 text-xs transition-colors hover:bg-surface-2"
            >
              <span className="w-24 shrink-0 text-muted">{formatShortDate(d.date)}</span>
              <span className="flex-1 font-mono tabular-nums text-fg">
                {d.top12WithHr != null ? `${d.top12WithHr}/12` : "—"}
                {d.top12Rate != null && d.restRate != null
                  ? ` · ${formatPct(d.top12Rate, 0)} vs ${formatPct(d.restRate, 0)}`
                  : ""}
                {d.baselineHits != null && d.baselineN
                  ? ` · szn ${d.baselineHits}/${d.baselineN}`
                  : ""}
              </span>
              <span className="text-subtle">
                {d.lockStatus === "locked" ? "locked" : "rebuilt"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CalibTable({
  title,
  rows,
  nested,
}: {
  title: string;
  rows: BoardPayload["summary"]["calibration"];
  nested?: boolean;
}) {
  return (
    <div className={nested ? "" : "overflow-hidden rounded-2xl bg-surface shadow-hair"}>
      <p className="px-4 pt-3 text-[11px] tracking-wide text-muted uppercase">{title}</p>
      <ul className="mt-1 divide-y divide-border">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-3 px-4 py-2 text-xs tabular-nums">
            <span className="w-20 text-muted">{row.label}</span>
            <span className="w-10 text-subtle">{row.n}</span>
            <span className="flex-1 font-mono text-fg">{formatPct(row.meanP, 0)} pred</span>
            <span className="font-mono text-fg">{formatPct(row.actualRate, 0)} hit</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HeroStat({
  label,
  value,
  small,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-surface px-3 py-3 shadow-hair">
      <dt className="text-[11px] tracking-wide text-muted uppercase">{label}</dt>
      <dd className={cn("mt-1 text-fg", small ? "text-sm leading-snug" : "font-mono text-xl tabular-nums")}>
        {value}
      </dd>
    </div>
  );
}

function TopRow({
  player,
  rank,
  onOpen,
}: {
  player: PlayerPrediction;
  rank: number;
  onOpen: () => void;
}) {
  const matchup = [
    `${player.teamAbbr} ${player.isHome ? "vs" : "@"} ${player.opponentAbbr}`,
    player.pitcher?.name ?? "SP TBD",
    `#${player.battingOrder}`,
  ].join(" · ");

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-14 w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-2 sm:px-4"
      >
        <span className="w-7 shrink-0 text-right font-mono text-sm tabular-nums text-muted">
          {String(rank).padStart(2, "0")}
        </span>
        <img
          src={playerHeadshot(player.playerId)}
          alt=""
          className="size-10 shrink-0 rounded-full bg-surface-2 object-cover outline outline-1 -outline-offset-1 outline-fg/10"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{player.name}</span>
          <span className="mt-0.5 block truncate text-xs text-muted">{matchup}</span>
          {player.signal ? (
            <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase",
                  player.signal.grade === "loud"
                    ? "bg-sage-dim text-sage"
                    : player.signal.grade === "live"
                      ? "bg-gold/15 text-gold"
                      : player.signal.grade === "fade"
                        ? "bg-danger/20 text-danger"
                        : "bg-surface-2 text-muted",
                )}
              >
                {player.signal.grade}
              </span>
              {player.signal.keyMatch?.loud ? (
                <span className="rounded-full bg-sage-dim px-2 py-0.5 text-[10px] font-medium text-sage">
                  {player.signal.keyMatch.name}{" "}
                  {player.signal.keyMatch.barrelPct != null
                    ? `${player.signal.keyMatch.barrelPct.toFixed(0)}% BRL`
                    : `${player.signal.keyMatch.iso!.toFixed(2)} ISO`}
                  {" · "}
                  {Math.round(player.signal.keyMatch.usage * 100)}% mix
                </span>
              ) : (
                <span className="truncate text-[11px] text-muted">{player.signal.headline}</span>
              )}
            </span>
          ) : player.reasons.length > 0 ? (
            <span className="mt-1.5 flex flex-wrap gap-1">
              {player.reasons.map((r) => (
                <Badge key={r} variant="outline">
                  {r}
                </Badge>
              ))}
            </span>
          ) : null}
        </span>
        <span className="hidden w-12 shrink-0 text-right font-mono text-xs tabular-nums text-subtle sm:block">
          {player.park.airIndex}
        </span>
        <ConfidenceMark band={player.confidenceBand} />
        <span className="w-[4.5rem] shrink-0 text-right">
          <span className="block font-mono text-base tabular-nums text-fg">
            {formatPct(player.pHr)}
          </span>
          {player.actualHr != null && player.actualHr > 0 ? (
            <Badge variant="sage" className="mt-0.5">
              {player.actualHr} HR
            </Badge>
          ) : (
            <span className="block text-[11px] text-subtle">P(HR)</span>
          )}
        </span>
      </button>
    </li>
  );
}

function VulnerableList({
  rows,
  predictions,
  query,
  team,
  onOpen,
}: {
  rows: VulnerablePitcher[];
  predictions: PlayerPrediction[];
  query?: string;
  team?: string;
  onOpen: (p: PlayerPrediction) => void;
}) {
  const q = (query ?? "").trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (team && r.teamAbbr !== team && r.opponentAbbr !== team) return false;
    if (!q) return true;
    return (
      r.name.toLowerCase().includes(q) ||
      r.teamAbbr.toLowerCase().includes(q) ||
      r.opponentAbbr.toLowerCase().includes(q) ||
      r.targets.some((t) => t.name.toLowerCase().includes(q) || t.lastName.toLowerCase().includes(q))
    );
  });
  if (shown.length === 0) return null;

  const openTarget = (t: VulnerablePitcher["targets"][0]) => {
    const hit = predictions.find((p) => p.playerId === t.playerId && p.gamePk === t.gamePk);
    if (hit) onOpen(hit);
  };

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[11px] font-medium tracking-[0.22em] text-gold uppercase">
          Pitchers to target
        </h2>
        <p className="text-xs text-subtle">Air allowed × park · top looks against them</p>
      </div>
      <ol className="list-none divide-y divide-border overflow-hidden rounded-3xl bg-surface shadow-hair p-0">
        {shown.map((r, i) => (
          <li key={`${r.pitcherId}:${r.gamePk}`} className="px-3 py-3 sm:px-4">
            <div className="flex items-start gap-3">
              <span className="w-7 shrink-0 pt-2 text-right font-mono text-sm tabular-nums text-muted">
                {String(i + 1).padStart(2, "0")}
              </span>
              <img
                src={playerHeadshot(r.pitcherId)}
                alt=""
                className="mt-0.5 size-10 shrink-0 rounded-full bg-surface-2 object-cover outline outline-1 -outline-offset-1 outline-fg/10"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{r.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {`${r.throws}HP`} · {r.teamAbbr} {r.isHome ? "vs" : "@"} {r.opponentAbbr}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase",
                        r.grade === "loud"
                          ? "bg-sage-dim text-sage"
                          : r.grade === "live"
                            ? "bg-gold/15 text-gold"
                            : "bg-surface-2 text-muted",
                      )}
                    >
                      {r.grade}
                    </span>
                    <p className="mt-1 font-mono text-xs tabular-nums text-subtle">{r.parkAir} air</p>
                  </div>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">{r.why}</p>
                {r.kPct != null || r.whiffPct != null || r.whip != null ? (
                  <p className="mt-0.5 font-mono text-[11px] tabular-nums text-subtle">
                    {r.kPct != null ? `${r.kPct.toFixed(1)}% K` : ""}
                    {r.kPct != null && (r.whiffPct != null || r.whip != null) ? " · " : ""}
                    {r.whiffPct != null ? `${r.whiffPct.toFixed(1)}% whiff` : ""}
                    {r.whiffPct != null && r.whip != null ? " · " : ""}
                    {r.whip != null ? `${r.whip.toFixed(2)} WHIP` : ""}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.targets.map((t) => (
                    <button
                      key={t.playerId}
                      type="button"
                      onClick={() => openTarget(t)}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-left transition-colors hover:bg-bg"
                    >
                      <span
                        className={cn(
                          "text-[10px] font-medium tracking-wide uppercase",
                          t.grade === "loud"
                            ? "text-sage"
                            : t.grade === "live"
                              ? "text-gold"
                              : "text-subtle",
                        )}
                      >
                        {t.grade}
                      </span>
                      <span className="text-xs text-fg">{t.lastName || t.name}</span>
                      <span className="font-mono text-[11px] tabular-nums text-muted">
                        {formatPct(t.pHr, 0)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SearchRow({
  date,
  query,
  team,
  stable,
}: {
  date: string;
  query?: string;
  team?: string;
  stable?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <form
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const q = String(fd.get("q") ?? "").trim();
        void navigate({
          to: "/",
          search: { date, q: q || undefined, team, stable: stable ? "1" : undefined },
        });
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
      <input
        name="q"
        defaultValue={query ?? ""}
        placeholder="Search a batter, team, or pitcher"
        autoComplete="off"
        suppressHydrationWarning
        className="h-11 w-full rounded-2xl border-0 bg-surface pr-4 pl-10 text-sm text-fg shadow-hair outline-none placeholder:text-subtle focus-visible:shadow-hair-strong"
      />
    </form>
  );
}

function FilterChip({
  children,
  to,
  date,
  query,
  team,
  stable,
  active,
}: {
  children: React.ReactNode;
  to: "/";
  date: string;
  query?: string;
  team?: string;
  stable?: boolean;
  active?: boolean;
}) {
  return (
    <Button
      variant={active ? "default" : "secondary"}
      size="sm"
      className="h-9 shrink-0 rounded-full"
      asChild
    >
      <Link
        to={to}
        search={{ date, q: query, team, stable: stable ? "1" : undefined }}
      >
        {children}
      </Link>
    </Button>
  );
}

function ConfidenceMark({ band }: { band: ConfidenceBand }) {
  return (
    <span
      className={cn(
        "hidden w-12 text-right text-[11px] font-medium tracking-wide uppercase sm:block",
        band === "stable" ? "text-sage" : band === "thin" ? "text-subtle" : "text-muted",
      )}
    >
      {band}
    </span>
  );
}

function EmptyDate() {
  return (
    <div className="rounded-3xl bg-surface px-6 py-16 text-center shadow-hair">
      <p className="font-display text-3xl tracking-tight">Off day.</p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
        No MLB games on this date. Step to the next slate with the arrows above.
      </p>
    </div>
  );
}
