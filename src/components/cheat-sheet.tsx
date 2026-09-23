"use client";

import { juiceCall, mixGrid, mixIso, MIX_GRID } from "@/lib/mlb/bvp";
import { readJuice, readMixHr, readMixIso } from "@/lib/mlb/metric-read";
import type { PlayerPrediction } from "@/lib/mlb/types";
import { cn } from "@/lib/utils";

export function SheetStrip({ player }: { player: PlayerPrediction }) {
  const grid = mixGrid(player).filter((g) => g.pct >= 0.08);
  const juice = juiceCall(player);
  const mixHr = player.signal.decision.mixHr ?? 0;
  if (grid.length === 0 && mixHr < 1 && juice.call === "no") return null;
  return (
    <span className="mt-1.5 block">
      {grid.length > 0 ? (
        <span className="flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10px] tabular-nums text-muted">
          {grid.map((g) => (
            <span key={g.code} className={g.pct >= 0.22 ? "text-sage" : undefined}>
              {g.code} {Math.round(g.pct * 100)}
            </span>
          ))}
        </span>
      ) : null}
      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 font-medium tracking-wide uppercase",
            juice.call === "yes"
              ? "bg-sage-dim text-sage"
              : juice.call === "lean"
                ? "bg-gold/15 text-gold"
                : "bg-surface-2 text-subtle",
          )}
        >
          {juice.call === "yes" ? "Juice" : juice.call === "lean" ? "Some juice" : "No juice"}
        </span>
        <span className={cn("tabular-nums", mixHr >= 2 ? "text-sage" : "text-subtle")}>
          {mixHr} HR on types
        </span>
      </span>
    </span>
  );
}

export function CheatSheetCard({ player }: { player: PlayerPrediction }) {
  const grid = mixGrid(player);
  const mixHr = player.signal.decision.mixHr ?? 0;
  const arm = player.pitcher?.name.split(" ").slice(-1)[0] ?? "SP";
  const shown = grid.filter((g) => g.pct >= 0.05);
  return (
    <div className="mt-4 rounded-3xl bg-surface-2 px-3 py-3">
      <p className="text-[10px] tracking-wide text-gold uppercase">Cheat sheet</p>
      <p className="mt-1 text-sm leading-snug text-fg">
        {player.lastName || player.name} vs {arm}
        {shown.length
          ? ` · mix ${shown.map((g) => `${g.code} ${Math.round(g.pct * 100)}`).join(" / ")}`
          : ""}
      </p>
      <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5">
        {MIX_GRID.map((code) => {
          const g = grid.find((x) => x.code === code)!;
          const hot = g.pct >= 0.2;
          return (
            <div
              key={code}
              className={cn(
                "min-w-9 rounded-xl px-1.5 py-1 text-center",
                g.pct >= 0.08 ? "bg-surface" : "opacity-40",
              )}
            >
              <p className="text-[9px] tracking-wide text-subtle">{code}</p>
              <p className={cn("font-mono text-[11px] tabular-nums", hot ? "text-sage" : "text-fg")}>
                {g.pct >= 0.04 ? Math.round(g.pct * 100) : "·"}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[12px] leading-snug text-muted">
        {readJuice(player).line} {readMixHr(mixHr).line}
        {mixIso(player) != null ? ` ${readMixIso(mixIso(player)).line}` : ""}
      </p>
    </div>
  );
}