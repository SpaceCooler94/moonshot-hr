import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { FollowList } from "@/components/follow-list";
import { getHrModel } from "@/lib/mlb/get-board";
import { todayISODateET } from "@/lib/mlb/format";
import { parseDateSearch } from "@/lib/search";

export const Route = createFileRoute("/model")({
  validateSearch: parseDateSearch,
  loader: () => getHrModel(),
  component: ModelPage,
});

function ModelPage() {
  const { date } = Route.useSearch();
  const art = Route.useLoaderData();
  return (
    <Shell date={date ?? todayISODateET()}>
      <article className="mx-auto max-w-2xl space-y-8">
        <header>
          <p className="text-xs font-medium tracking-[0.22em] text-gold uppercase">
            {art?.version ?? "untrained"}
          </p>
          <h1 className="mt-1 font-display text-4xl leading-tight">Named coefficients. Cuts from a curve.</h1>
          <p className="mt-4 text-base leading-relaxed text-muted">
            P is logistic: sigmoid(w0 + Σ wi zi). Weights come from L2 IRLS on 2025 batter-games.
            2026 is the walk-forward test. LOOK is the calibrated tail whose hit rate cleared the
            curve — not a round 55.
          </p>
        </header>

        {!art ? (
          <p className="rounded-2xl bg-surface px-4 py-4 text-sm text-muted shadow-hair">
            No trained artifact yet. The board is still on the old stack until train finishes.
          </p>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-3">
              <Stat label="Train n" value={String(art.metrics.train.n)} />
              <Stat label="Calib Brier" value={art.metrics.calib.brier.toFixed(4)} />
              <Stat
                label="Test Brier"
                value={art.metrics.test ? art.metrics.test.brier.toFixed(4) : "—"}
              />
            </section>
            <section className="rounded-3xl bg-surface px-4 py-4 shadow-hair">
              <h2 className="font-display text-xl">Cuts</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                LOOK ≥ {(art.cuts.look * 100).toFixed(1)}% (calib hit rate {(art.cuts.lookRate * 100).toFixed(0)}%,
                ~{art.cuts.looksPerNight.toFixed(1)} per night). WATCH ≥ {(art.cuts.watch * 100).toFixed(1)}%.{" "}
                {art.capWhy}
              </p>
              <p className="mt-2 text-xs text-subtle">λ = {art.lambda} · trained {art.trainedAt.slice(0, 10)}</p>
            </section>
            <section>
              <h2 className="font-display text-xl">Coefficients</h2>
              <ol className="mt-3 space-y-1">
                {art.coefficients
                  .slice()
                  .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
                  .map((c) => (
                    <li key={c.name} className="flex justify-between gap-3 font-mono text-sm tabular-nums">
                      <span className="text-muted">{c.name}</span>
                      <span className="text-fg">{c.w.toFixed(3)}</span>
                    </li>
                  ))}
              </ol>
            </section>
            {art.metrics.calib.deciles?.length ? (
              <section>
                <h2 className="font-display text-xl">Calib deciles</h2>
                <ol className="mt-3 space-y-1">
                  {art.metrics.calib.deciles.map((d) => (
                    <li key={d.lo} className="flex justify-between gap-3 font-mono text-xs tabular-nums text-muted">
                      <span>
                        {(d.lo * 100).toFixed(1)}–{(d.hi * 100).toFixed(1)} · n={d.n}
                      </span>
                      <span>
                        p {(d.meanP * 100).toFixed(1)} · y {(d.actual * 100).toFixed(1)}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </>
        )}

        <FollowList />
      </article>
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface px-4 py-3 shadow-hair">
      <p className="text-xs tracking-wide text-subtle uppercase">{label}</p>
      <p className="mt-1 font-mono text-lg tabular-nums text-fg">{value}</p>
    </div>
  );
}
