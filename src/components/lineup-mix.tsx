"use client";

import { useMemo, useState } from "react";
import { playerHeadshot } from "@/lib/mlb/format";
import { givesUp, hrsOnMix, mixUniverse } from "@/lib/mlb/bvp";
import { callClass, markBest, readHr9, vsScore } from "@/lib/mlb/metric-read";
import type { GameCard, PlayerPrediction } from "@/lib/mlb/types";
import { cn } from "@/lib/utils";

export function LineupMix({
  games,
  pool,
  onOpen,
}: {
  games: GameCard[];
  pool: PlayerPrediction[];
  onOpen: (p: PlayerPrediction) => void;
}) {
  const slates = useMemo(() => {
    const out: Array<{
      key: string;
      game: GameCard;
      pitcher: NonNullable<PlayerPrediction["pitcher"]>;
      side: "away" | "home";
      team: string;
      vs: string;
      official: boolean;
      bats: PlayerPrediction[];
    }> = [];
    for (const g of games) {
      for (const side of ["away", "home"] as const) {
        const teamId = g[side].id;
        const bats = pool
          .filter((p) => p.gamePk === g.gamePk && p.teamId === teamId)
          .sort((a, b) => a.battingOrder - b.battingOrder);
        if (bats.length === 0) continue;
        const pit = bats[0].pitcher;
        if (!pit) continue;
        out.push({
          key: `${g.gamePk}:${side}`,
          game: g,
          pitcher: pit,
          side,
          team: g[side].abbr,
          vs: g[side === "away" ? "home" : "away"].abbr,
          official: g.lineupSource === "official",
          bats,
        });
      }
    }
    return out;
  }, [games, pool]);

  const [pick, setPick] = useState(0);
  const [hand, setHand] = useState<"all" | "R" | "L">("all");
  const [codes, setCodes] = useState<string[] | null>(null);

  if (slates.length === 0) return null;
  const slate = slates[Math.min(pick, slates.length - 1)]!;
  const mixRows = mixUniverse(slate.bats[0]?.pitchMatrix?.pitcher ?? []).filter((r) => r.pct >= 0.1);
  const active = codes ?? mixRows.map((r) => r.code);
  const rows = slate.bats.filter((p) => (hand === "all" ? true : p.bats === hand || p.bats === "S"));

  const ranked = [...rows].sort((a, b) => vsScore(b, active) - vsScore(a, active) || hrsOnMix(b, active) - hrsOnMix(a, active));
  const pit = slate.pitcher;
  const allowed = givesUp(slate.bats[0], active);
  const lhbHr = rows.filter((p) => p.bats === "L").reduce((s, p) => s + hrsOnMix(p, active), 0);
  const rhbHr = rows.filter((p) => p.bats === "R").reduce((s, p) => s + hrsOnMix(p, active), 0);
  const topPitch = allowed.byPitch[0];
  const grades = markBest(ranked, active);
  const lead = ranked[0];
  const leadGrade = lead ? grades.get(`${lead.playerId}:${lead.gamePk}`) : null;
  const pen = slate.side === "away" ? slate.game.penHome : slate.game.penAway;

  const toggle = (code: string) => {
    const cur = new Set(active);
    if (cur.has(code)) {
      if (cur.size === 1) return;
      cur.delete(code);
    } else cur.add(code);
    setCodes([...cur]);
  };

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-medium tracking-[0.22em] text-gold uppercase">Lineup mix</h2>
        <p className="text-xs text-subtle">Who he gives HRs to · mix · hand · spray</p>
      </div>

      <div className="overflow-hidden rounded-3xl bg-surface shadow-hair">
        <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-2">
          {slates.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setPick(i);
                setCodes(null);
                setHand("all");
              }}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-xs",
                i === pick ? "bg-gold/15 text-gold" : "text-muted hover:bg-surface-2",
              )}
            >
              {s.team} vs {s.pitcher.name.split(" ").slice(-1)[0]}
            </button>
          ))}
        </div>

        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <img
              src={playerHeadshot(pit.id)}
              alt=""
              className="size-10 rounded-full bg-surface-2 object-cover outline outline-1 -outline-offset-1 outline-fg/10"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">{pit.name}</p>
              <p className="text-xs text-muted">
                {pit.throws}HP · {slate.team} {slate.side === "home" ? "vs" : "@"} {slate.vs}
                {slate.official ? (
                  <span className="ml-2 text-sage">Confirmed</span>
                ) : (
                  <span className="ml-2 text-gold">Projected</span>
                )}
              </p>
              {pit.stuff?.down ? (
                <p className="mt-0.5 text-xs text-gold">{pit.stuff.line}</p>
              ) : null}
              {pen?.likelyExit ? (
                <p className="mt-0.5 text-xs text-muted">{pen.line}</p>
              ) : null}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Stat k="Arm" v={readHr9(pit.hr9).word} hot={readHr9(pit.hr9).tone === "loud"} cold={readHr9(pit.hr9).tone === "quiet"} />
            <Stat k="Hunt" v={topPitch ? topPitch.name : "—"} hot={!!topPitch && topPitch.hr >= 2} />
            <Stat k="Order" v={lhbHr >= rhbHr ? "LHB" : "RHB"} hot />
          </div>
          {allowed.byPitch.length > 0 ? (
            <p className="mt-3 text-sm leading-snug text-fg">
              {readHr9(pit.hr9).line}{" "}
              {topPitch && topPitch.hr >= 1
                ? `Hunt the ${topPitch.name}.`
                : "No single pitch is bleeding yet."}{" "}
              {leadGrade?.call === "best"
                ? `${lead?.lastName || lead?.name} is the guy in this order.`
                : "Nobody in this order is a clear yes."}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5 px-3 py-3">
          {mixRows.map((r) => {
            const on = active.includes(r.code);
            const give = allowed.byPitch.find((x) => x.code === r.code);
            return (
              <button
                key={r.code}
                type="button"
                onClick={() => toggle(r.code)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium",
                  on ? "bg-gold/20 text-gold" : "bg-surface-2 text-subtle",
                )}
              >
                {give?.name ?? r.code} {Math.round(r.pct * 100)}%
                {give && give.hr > 0 ? ` · ${give.hr} HR` : ""}
              </button>
            );
          })}
        </div>
        <p className="px-4 pb-2 text-[11px] leading-relaxed text-subtle">
          Green = THE GUY. Gold = yes. Gray = skip. You don’t compare the numbers — the grade already did.
        </p>
        <div className="flex gap-1 px-3 pb-3">
          {(["all", "R", "L"] as const).map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHand(h)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px]",
                hand === h ? "bg-sage-dim text-sage" : "text-muted hover:bg-surface-2",
              )}
            >
              {h === "all" ? "All" : `${h}HB`}
            </button>
          ))}
        </div>

        <ul className="divide-y divide-border">
          {ranked.map((p) => {
            const g = grades.get(`${p.playerId}:${p.gamePk}`)!;
            return (
              <li key={`${p.playerId}:${p.gamePk}`}>
                <button
                  type="button"
                  onClick={() => onOpen(p)}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2",
                    g.call === "best" ? "bg-sage-dim/35" : "",
                  )}
                >
                  <span className="w-5 shrink-0 font-mono text-xs tabular-nums text-muted">{p.battingOrder}</span>
                  <img
                    src={playerHeadshot(p.playerId)}
                    alt=""
                    className="size-9 shrink-0 rounded-full bg-surface-2 object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-fg">{p.lastName || p.name}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase", callClass(g.call))}>
                        {g.title}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted">{g.why}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function Stat({ k, v, hot, cold }: { k: string; v: string; hot?: boolean; cold?: boolean }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-2 py-2">
      <p className="text-[10px] tracking-wide text-subtle uppercase">{k}</p>
      <p className={cn("font-mono text-sm tabular-nums", hot ? "text-sage" : cold ? "text-danger" : "text-fg")}>
        {v}
      </p>
    </div>
  );
}
