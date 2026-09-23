"use client";

import { useEffect, useState } from "react";
import { formatGameTime, formatPct, playerHeadshot } from "@/lib/mlb/format";
import { getPlayer } from "@/lib/mlb/get-board";
import { gradeLook, type LookBit, type LookCall } from "@/lib/mlb/look";
import type { PlayerPrediction } from "@/lib/mlb/types";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

export function PlayerDetail({
  player,
  open,
  onOpenChange,
  date,
}: {
  player: PlayerPrediction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date?: string;
}) {
  const [full, setFull] = useState<PlayerPrediction | null>(player);
  useEffect(() => {
    if (!open || !player) {
      setFull(player);
      return;
    }
    setFull(player);
    let live = true;
    void getPlayer({ data: { date, playerId: player.playerId, gamePk: player.gamePk } })
      .then((next) => {
        if (!live || !next) return;
        if (next.playerId === player.playerId && next.gamePk === player.gamePk) setFull(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, player, date]);
  const shown = full ?? player;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-h-[88dvh] overflow-y-auto">
        {shown ? <Sheet player={shown} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Sheet({ player }: { player: PlayerPrediction }) {
  const g = gradeLook(player);
  const went = (player.actualHr ?? 0) > 0;
  return (
    <div>
      <DialogTitle className="sr-only">{player.name}</DialogTitle>
      <DialogDescription className="sr-only">
        {g.title}. {g.why}
      </DialogDescription>
      <div className="flex items-start gap-4">
        <img
          src={playerHeadshot(player.playerId)}
          alt=""
          className="size-16 rounded-full bg-surface-2 object-cover outline outline-1 -outline-offset-1 outline-fg/10"
        />
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            {player.teamAbbr} · {player.bats}HB · #{player.battingOrder}
          </p>
          <h2 className="font-display text-3xl leading-tight tracking-tight">{player.name}</h2>
          <p className="mt-1 text-sm text-muted">
            {player.isHome ? "vs" : "@"} {player.opponentAbbr}
            {player.pitcher ? ` · ${player.pitcher.name}` : " · SP TBD"} · {formatGameTime(player.gameTime)} ET
          </p>
        </div>
      </div>

      {went ? (
        <p className="mt-4 rounded-2xl bg-sage-dim px-4 py-3 font-display text-2xl tracking-tight text-sage">
          {player.actualHr} HR tonight
          <span className="mt-1 block font-sans text-xs font-medium tracking-wide text-sage/80 uppercase">
            Research was {g.title} — the ball still went out
          </span>
        </p>
      ) : (
        <p className={cn("mt-4 font-display text-2xl tracking-tight", callTone(g.call))}>{g.title}</p>
      )}
      <p className="mt-2 text-sm leading-relaxed text-fg">{g.why}</p>
      <p className="mt-1 text-xs text-subtle">A look is not a ticket. Sit is the default.</p>

      <p className="mt-6 font-mono text-sm tabular-nums text-muted">
        Size {formatPct(player.pHr)} · stack {Math.round(g.score * 100)} · capped. Not a price.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-2">
        <Bit bit={g.power} />
        <Bit bit={g.mix} />
        <Bit bit={g.park} />
        <Bit bit={g.order} />
      </dl>
    </div>
  );
}

function Bit({ bit }: { bit: LookBit }) {
  const pct = Math.round(bit.score * 100);
  return (
    <div className="rounded-2xl bg-surface-2 px-3 py-3">
      <dt className="flex items-center justify-between text-xs tracking-wide uppercase">
        <span className="text-subtle">
          {bit.weight > 0 ? `${bit.label} · ${Math.round(bit.weight * 100)}` : `${bit.label} · gate`}
        </span>
        <span className={bit.on ? "text-sage" : "text-muted"}>{bit.on ? "On" : "Off"}</span>
      </dt>
      <dd className="mt-2">
        <span className="block h-1 overflow-hidden rounded-full bg-bg">
          <span className={cn("block h-1 rounded-full", bit.on ? "bg-sage" : "bg-gold/50")} style={{ width: `${pct}%` }} />
        </span>
        <span className="mt-1.5 block text-sm leading-snug text-fg">{bit.line}</span>
      </dd>
    </div>
  );
}

function callTone(call: LookCall): string {
  if (call === "look") return "text-sage";
  if (call === "watch") return "text-gold";
  return "text-muted";
}
