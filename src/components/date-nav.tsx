import { useState } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { bustBoard } from "@/lib/mlb/get-board";
import { formatLongDate, shiftISODate, todayISODateET } from "@/lib/mlb/format";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export function DateNav({ date }: { date: string }) {
  const today = todayISODateET();
  const prev = shiftISODate(date, -1);
  const next = shiftISODate(date, 1);
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const canRefresh = pathname === "/" || pathname.startsWith("/slate");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (busy) return;
    setBusy(true);
    try {
      await bustBoard({ data: { date } });
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 sm:gap-1">
        <Button variant="ghost" size="icon" className="size-11 shrink-0" asChild>
          <Link to="." search={(s) => ({ ...s, date: prev })} aria-label="Previous day">
            <ChevronLeft />
          </Link>
        </Button>
        <p className="min-w-0 flex-1 truncate text-center font-display text-base leading-tight tracking-tight sm:text-xl">
          {formatLongDate(date)}
        </p>
        <Button variant="ghost" size="icon" className="size-11 shrink-0" asChild>
          <Link to="." search={(s) => ({ ...s, date: next })} aria-label="Next day">
            <ChevronRight />
          </Link>
        </Button>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {date !== today ? (
          <Button variant="outline" size="sm" className="shrink-0" asChild>
            <Link to="." search={(s) => ({ ...s, date: today })}>
              Today
            </Link>
          </Button>
        ) : null}
        {canRefresh ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            onClick={refresh}
            disabled={busy}
            aria-label="Refresh slate"
            title="Pull latest lineups and weather"
          >
            <RefreshCw className={cn(busy && "animate-spin")} />
          </Button>
        ) : date === today ? (
          <span className="hidden shrink-0 text-xs font-medium tracking-wide text-muted uppercase sm:inline">
            ET slate
          </span>
        ) : null}
      </div>
    </div>
  );
}
