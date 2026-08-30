import { MOONSHOT_FOLLOWS } from "@/lib/mlb/follows";

export function FollowList({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-[11px] font-medium tracking-[0.22em] text-gold uppercase">Follow</h2>
          <p className="text-xs text-subtle">in order · research, not sheets</p>
        </div>
        <ol className="flex flex-wrap gap-2">
          {MOONSHOT_FOLLOWS.map((a) => (
            <li key={a.handle}>
              <a
                href={`https://x.com/${a.handle}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-surface/90 px-3 py-1.5 text-sm text-fg shadow-glow transition-colors hover:bg-surface-2"
              >
                <span className="font-mono text-[11px] tabular-nums text-muted">
                  {String(a.order).padStart(2, "0")}
                </span>
                <span>@{a.handle}</span>
              </a>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <section className="mt-10">
      <p className="text-[11px] font-medium tracking-[0.22em] text-gold uppercase">Follow</p>
      <h2 className="mt-1 font-display text-2xl tracking-tight">In order, for Moonshot.</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Data people we actually used — not daily cheat sheets. Open them on X.
      </p>
      <ol className="mt-5 list-none divide-y divide-border overflow-hidden rounded-3xl bg-surface shadow-hair p-0">
        {MOONSHOT_FOLLOWS.map((a) => (
          <li key={a.handle}>
            <a
              href={`https://x.com/${a.handle}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2"
            >
              <span className="w-7 shrink-0 pt-0.5 text-right font-mono text-sm tabular-nums text-muted">
                {String(a.order).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg">
                  {a.name}{" "}
                  <span className="font-normal text-sage">@{a.handle}</span>
                </span>
                <span className="mt-0.5 block text-sm leading-relaxed text-muted">{a.why}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
