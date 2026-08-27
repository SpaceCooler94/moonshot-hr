import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { DateNav } from "./date-nav";

const NAV = [
  { to: "/", label: "Board" },
  { to: "/slate", label: "Slate" },
  { to: "/model", label: "Model" },
] as const;

export function Shell({
  children,
  date,
  showDate = true,
}: {
  children: React.ReactNode;
  date: string;
  showDate?: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-dvh bg-transparent text-fg">
      <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-2 sm:gap-3">
            <Link to="/" className="flex min-h-11 min-w-0 items-center gap-2 sm:gap-2.5">
              <MoonMark />
              <span className="flex min-w-0 flex-col leading-none">
                <span className="font-display text-base font-semibold tracking-[0.1em] text-fg uppercase sm:text-xl sm:tracking-[0.16em]">
                  Moonshot
                </span>
                <span className="mt-1 hidden text-[10px] font-medium tracking-[0.22em] text-gold uppercase sm:block">
                  Home run research
                </span>
              </span>
            </Link>
            <nav className="flex shrink-0 items-center gap-0.5 rounded-full bg-surface p-0.5 shadow-hair sm:p-1">
              {NAV.map((item) => {
                const active =
                  item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    search={(prev) => prev}
                    className={cn(
                      "flex h-9 items-center rounded-full px-2.5 text-xs font-medium transition-colors sm:px-3.5 sm:text-sm",
                      active ? "bg-accent text-accent-fg" : "text-muted hover:text-fg",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          {showDate ? <DateNav date={date} /> : null}
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
        <p className="text-xs leading-relaxed text-subtle">
          Moonshot models P(HR) from season rates, pitcher HR/BF, park factor, platoon,
          weather, and recent form. Live data via MLB Stats API. For research — not a wagering
          product.
        </p>
      </footer>
    </div>
  );
}

function MoonMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-7 shrink-0 text-gold sm:size-8" aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="none" stroke="currentColor" strokeWidth="1.15" opacity="0.7" />
      <circle cx="16" cy="16" r="12.6" fill="none" stroke="currentColor" strokeWidth="0.45" opacity="0.35" />
      <path
        fill="currentColor"
        d="M18.5 6.6a9 9 0 1 0 6.6 15.8 7.2 7.2 0 0 1-6.6-15.8Z"
      />
      <circle cx="22.6" cy="8.8" r="1" fill="currentColor" />
    </svg>
  );
}
