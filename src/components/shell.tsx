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
    <div className="relative min-h-dvh bg-transparent text-fg">
      <div className="cosmos" aria-hidden="true">
        <div className="cosmos-nebula" />
        <div className="cosmos-smoke" />
        <div className="cosmos-stars" />
        <div className="cosmos-stars cosmos-stars-b" />
        <img
          src="/brand/orbit.jpg"
          alt=""
          className="pointer-events-none absolute -right-8 -bottom-16 h-[58vh] w-auto max-w-none opacity-[0.22] mix-blend-screen sm:right-0 sm:bottom-[-4vh] sm:h-[70vh] sm:opacity-[0.28]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/55 to-bg/20" />
        <Starfield />
      </div>
      <header className="sticky top-0 z-40 border-b border-border bg-bg/55 backdrop-blur-md">
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
      <main className="relative z-10 mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      <footer className="relative z-10 mx-auto max-w-6xl px-4 pb-10 sm:px-6">
        <p className="text-xs leading-relaxed text-subtle">
          Moonshot models P(HR) from season rates, pitcher HR/BF, park factor, platoon,
          weather, and recent form. Live data via MLB Stats API. For research — not a wagering
          product.
        </p>
      </footer>
    </div>
  );
}

function Starfield() {
  return (
    <div className="absolute inset-0">
      {STARS.map((s, i) => (
        <span
          key={i}
          className={cn(
            "star",
            s.kind === "sage" && "star-sage",
            s.kind === "gold" && "star-gold",
            s.flare && "star-flare",
          )}
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            ["--dur" as string]: `${s.dur}s`,
            ["--delay" as string]: `${s.delay}s`,
          }}
        />
      ))}
      {SPARKS.map((s, i) => (
        <span
          key={`sp${i}`}
          className={cn("spark", s.kind === "gold" && "spark-gold", s.kind === "sage" && "spark-sage")}
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            ["--dur" as string]: `${s.dur}s`,
            ["--delay" as string]: `${s.delay}s`,
          }}
        />
      ))}
      {METEORS.map((m, i) => (
        <span
          key={`m${i}`}
          className="meteor"
          style={{
            left: `${m.x}%`,
            top: `${m.y}%`,
            ["--dur" as string]: `${m.dur}s`,
            ["--delay" as string]: `${m.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

const STARS = seedStars(120);
const SPARKS = seedSparks(22);
const METEORS = [
  { x: 92, y: 6, dur: 9.5, delay: 0.4 },
  { x: 78, y: 14, dur: 12, delay: 3.1 },
  { x: 88, y: 22, dur: 10.5, delay: 5.8 },
  { x: 70, y: 8, dur: 13, delay: 8.2 },
  { x: 96, y: 30, dur: 11, delay: 11.4 },
] as const;

function seedSparks(n: number) {
  const kinds = ["cream", "gold", "cream", "sage"] as const;
  const out: Array<{ x: number; y: number; size: number; dur: number; delay: number; kind: (typeof kinds)[number] }> = [];
  let a = 7919;
  for (let i = 0; i < n; i++) {
    a = (a * 48271) % 2147483647;
    const x = 4 + (a % 920) / 10;
    a = (a * 48271) % 2147483647;
    const y = 3 + (a % 880) / 10;
    a = (a * 48271) % 2147483647;
    const size = 8 + (a % 10);
    a = (a * 48271) % 2147483647;
    const dur = 2.4 + (a % 35) / 10;
    a = (a * 48271) % 2147483647;
    const delay = (a % 80) / 10;
    out.push({ x, y, size, dur, delay, kind: kinds[i % kinds.length] });
  }
  return out;
}

function seedStars(n: number) {
  const kinds = ["cream", "cream", "gold", "sage", "cream"] as const;
  const out: Array<{
    x: number;
    y: number;
    size: number;
    dur: number;
    delay: number;
    kind: (typeof kinds)[number];
    flare: boolean;
  }> = [];
  let a = 16807;
  for (let i = 0; i < n; i++) {
    a = (a * 48271) % 2147483647;
    const x = (a % 1000) / 10;
    a = (a * 48271) % 2147483647;
    const y = (a % 1000) / 10;
    a = (a * 48271) % 2147483647;
    const size = 1.4 + (a % 28) / 10;
    a = (a * 48271) % 2147483647;
    const dur = 1.4 + (a % 36) / 10;
    a = (a * 48271) % 2147483647;
    const delay = (a % 70) / 10;
    out.push({
      x,
      y,
      size,
      dur,
      delay,
      kind: kinds[i % kinds.length],
      flare: i % 6 === 0,
    });
  }
  return out;
}

function MoonMark() {
  return (
    <svg viewBox="0 0 32 32" className="moon-mark size-7 shrink-0 text-gold sm:size-8" aria-hidden="true">
      <g className="moon-orbit">
        <circle cx="16" cy="16" r="15" fill="none" stroke="currentColor" strokeWidth="1.15" opacity="0.7" />
        <circle cx="22.6" cy="8.8" r="1.15" fill="currentColor" />
      </g>
      <circle cx="16" cy="16" r="12.6" fill="none" stroke="currentColor" strokeWidth="0.45" opacity="0.35" />
      <path
        fill="currentColor"
        d="M18.5 6.6a9 9 0 1 0 6.6 15.8 7.2 7.2 0 0 1-6.6-15.8Z"
      />
    </svg>
  );
}
