"use client";

import { formatFactor, formatGameTime, formatPct, playerHeadshot, teamSpot } from "@/lib/mlb/format";
import { PARK_NOTES } from "@/lib/mlb/parks";
import type { Factor, HrCheck, HrSignal, KeyPitchMatch, PitcherInfo, PitchMixRow, PlayerPrediction } from "@/lib/mlb/types";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

export function PlayerDetail({
  player,
  open,
  onOpenChange,
}: {
  player: PlayerPrediction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        {player ? <PlayerBody player={player} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PlayerBody({ player }: { player: PlayerPrediction }) {
  const factors: Array<{ key: string; factor: Factor }> = [
    { key: "Batter", factor: player.factors.batter },
    { key: "Pitcher", factor: player.factors.pitcher },
    { key: "Air", factor: player.factors.park },
    { key: "Platoon", factor: player.factors.platoon },
    { key: "Form", factor: player.factors.form },
  ];
  const parkNote = PARK_NOTES[player.park.id];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-6 pr-16 pb-8 md:px-6">
      <DialogTitle className="sr-only">{player.name} home run model</DialogTitle>
      <DialogDescription className="sr-only">
        Matchup breakdown for {player.name}
      </DialogDescription>

      <div className="flex items-start gap-4">
        <img
          src={playerHeadshot(player.playerId)}
          alt=""
          className="size-16 rounded-full bg-surface-2 object-cover outline outline-1 -outline-offset-1 outline-fg/10"
        />
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            {player.teamAbbr} · {player.position} · {player.bats}HB · #{player.battingOrder}
          </p>
          <h2 className="font-display text-3xl leading-tight tracking-tight">{player.name}</h2>
          <p className="mt-1 text-sm text-muted">
            {player.isHome ? "vs" : "@"} {player.opponentAbbr}
            {player.pitcher ? ` · ${player.pitcher.name}` : " · SP TBD"} ·{" "}
            {formatGameTime(player.gameTime)} ET
          </p>
        </div>
      </div>

      <SignalCard player={player} />

      <TankTiles week={player.week} />

      {player.pitchMatrix ? <MatchupMatrix player={player} /> : null}

      <div className="mt-6 grid grid-cols-3 gap-2">
        <StatTile label="P(HR) vs SP" value={formatPct(player.pHr)} accent />
        <StatTile label="PA vs SP" value={player.expectedPa.toFixed(1)} />
        <StatTile label="Stability" value={`${Math.round(player.confidence * 100)}`} />
      </div>
      <p className="mt-2 text-xs text-subtle">
        {player.confidenceBand === "stable"
          ? "Stable look — full sample, posted card, listed starter."
          : player.confidenceNotes.length
            ? player.confidenceNotes.join(" · ")
            : "Fair look — some inputs still thin."}
        {player.pHrRaw - player.pHr > 0.015
          ? ` Raw stack ${formatPct(player.pHrRaw, 0)} shrunk to ${formatPct(player.pHr, 0)}.`
          : ""}
        {player.gamePa > player.expectedPa + 0.15
          ? ` ${Math.max(0, player.gamePa - player.expectedPa).toFixed(1)} PA after he exits — not in this P.`
          : ""}
      </p>

      {player.actualHr != null && player.gameStatus !== "preview" ? (
        player.actualHr > 0 ? (
          <p className="mt-3 rounded-xl bg-sage-dim px-3 py-2 text-sm text-sage">
            Went yard —{" "}
            <span className="font-medium tabular-nums">{player.actualHr} HR</span> in this game.
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted">No home run in this game.</p>
        )
      ) : null}

      {player.reasons.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {player.reasons.map((r) => (
            <span
              key={r}
              className="rounded-full bg-sage-dim px-2 py-0.5 text-[11px] font-medium tracking-wide text-sage"
            >
              {r}
            </span>
          ))}
        </div>
      ) : null}

      {player.statcast ? (
        <div className="mt-6 rounded-2xl bg-surface-2 p-3">
          <p className="text-[11px] tracking-wide text-muted uppercase">Statcast</p>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
            <SavantCell
              label="Barrels"
              value={player.statcast.barrel != null ? `${player.statcast.barrel.toFixed(1)}%` : "—"}
            />
            <SavantCell
              label="Blast"
              value={player.statcast.blast != null ? `${player.statcast.blast.toFixed(1)}%` : "—"}
            />
            <SavantCell
              label="Sweet"
              value={player.statcast.sweetSpot != null ? `${player.statcast.sweetSpot.toFixed(0)}%` : "—"}
            />
            <SavantCell
              label="EV"
              value={player.statcast.ev != null ? player.statcast.ev.toFixed(1) : "—"}
            />
            <SavantCell
              label="xISO"
              value={player.statcast.xIso != null ? player.statcast.xIso.toFixed(3) : "—"}
            />
            <SavantCell
              label="Hard hit"
              value={player.statcast.hardHit != null ? `${player.statcast.hardHit.toFixed(0)}%` : "—"}
            />
            <SavantCell
              label="Pull"
              value={player.statcast.pull != null ? `${player.statcast.pull.toFixed(0)}%` : "—"}
            />
            <SavantCell
              label="Fly ball"
              value={player.statcast.flyBall != null ? `${player.statcast.flyBall.toFixed(0)}%` : "—"}
            />
            <SavantCell
              label="Bat speed"
              value={player.statcast.swingSpeed != null ? player.statcast.swingSpeed.toFixed(1) : "—"}
            />
            <SavantCell
              label="Solid"
              value={player.statcast.solid != null ? `${player.statcast.solid.toFixed(1)}%` : "—"}
            />
            <SavantCell
              label="K / whiff"
              value={
                player.statcast.kPct != null || player.statcast.whiff != null
                  ? `${player.statcast.kPct != null ? `${player.statcast.kPct.toFixed(0)}%` : "—"} / ${player.statcast.whiff != null ? `${player.statcast.whiff.toFixed(0)}%` : "—"}`
                  : "—"
              }
            />
          </dl>
        </div>
      ) : null}

      {player.week || player.handSplit ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-surface-2 p-3">
            <p className="text-[11px] tracking-wide text-muted uppercase">Last 10 days</p>
            {player.week && player.week.bbe > 0 ? (
              <>
                <p className="mt-1 font-mono text-sm tabular-nums text-fg">
                  {player.week.barrelPct.toFixed(1)}% barrels
                </p>
                <p className="text-xs text-subtle">
                  {player.week.barrels}/{player.week.bbe} BBE
                  {player.week.ev != null ? ` · ${player.week.ev.toFixed(1)} EV` : ""}
                  {player.week.batSpeed != null ? ` · ${player.week.batSpeed.toFixed(1)} bat` : ""}
                  {player.week.solidPct != null ? ` · ${player.week.solidPct.toFixed(0)}% solid` : ""}
                  {player.week.weakPct != null ? ` · ${player.week.weakPct.toFixed(0)}% weak` : ""}
                </p>
                {player.week.ev100Last1 && player.week.maxEvLast1 != null ? (
                  <p className="mt-1 text-xs text-sage">
                    {player.week.maxEvLast1.toFixed(1)} mph last game
                    {player.week.n100Last3 >= 4 ? ` · ${player.week.n100Last3}× 100+ last 3` : ""}
                  </p>
                ) : player.week.n100Last3 >= 4 ? (
                  <p className="mt-1 text-xs text-sage">{player.week.n100Last3}× 100+ mph last 3</p>
                ) : player.week.n100Last3 >= 2 ? (
                  <p className="mt-1 text-xs text-sage">
                    {player.week.n100Last3}× 100+ mph last 3
                  </p>
                ) : null}
                {player.week.pullPct != null ? (
                  <p className="text-xs text-subtle">
                    {player.week.pullPct.toFixed(0)}% pull
                    {player.week.pullAirPct != null ? ` · ${player.week.pullAirPct.toFixed(0)}% pull air` : ""}
                    {player.week.idealAaPct != null ? ` · ${player.week.idealAaPct.toFixed(0)}% ideal AA` : ""}
                  </p>
                ) : player.week.idealAaPct != null ? (
                  <p className="text-xs text-subtle">{player.week.idealAaPct.toFixed(0)}% ideal AA last 10</p>
                ) : null}
                {player.week.launchBandLast3 ? (
                  <p className="text-xs text-sage">20–30° launch last 3</p>
                ) : player.week.launchBandLast5 ? (
                  <p className="text-xs text-sage">20–30° launch in {player.week.nLaunchBandLast5} of last 5</p>
                ) : null}
                {player.week.heart.bbe >= 4 || player.week.chase.bbe >= 4 ? (
                  <p className="text-xs text-subtle">
                    {player.week.heart.bbe >= 4
                      ? `heart ${player.week.heart.barrels}/${player.week.heart.bbe}`
                      : ""}
                    {player.week.heart.bbe >= 4 && player.week.chase.bbe >= 4 ? " · " : ""}
                    {player.week.chase.bbe >= 4
                      ? `chase ${player.week.chase.barrels}/${player.week.chase.bbe}`
                      : ""}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-1 text-sm text-subtle">No batted balls</p>
            )}
          </div>
          <div className="rounded-2xl bg-surface-2 p-3">
            <p className="text-[11px] tracking-wide text-muted uppercase">
              vs {player.pitcher?.throws === "L" ? "LHP" : player.pitcher?.throws === "R" ? "RHP" : "hand"}
            </p>
            <HandSplitLine player={player} />
          </div>
        </div>
      ) : null}

      {player.pitcher ? (
        <StarterMissBats pitcher={player.pitcher} tbf={player.starterTbf} />
      ) : null}

      <h3 className="mt-8 text-xs font-medium tracking-[0.14em] text-muted uppercase">
        Factor stack
      </h3>
      <ul className="mt-3 space-y-3">
        {factors.map(({ key, factor }) => (
          <li key={key}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="text-sm text-fg">{key}</span>
              <span
                className={cn(
                  "font-mono text-xs tabular-nums",
                  factor.value > 1.03 ? "text-sage" : factor.value < 0.97 ? "text-danger" : "text-muted",
                )}
              >
                {formatFactor(factor.value)}
              </span>
            </div>
            <FactorBar value={factor.value} />
            <p className="mt-1 text-xs text-subtle">{factor.label}</p>
          </li>
        ))}
      </ul>

      <div className="mt-8 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-surface-2 p-3">
          <p className="text-[11px] tracking-wide text-muted uppercase">Season</p>
          <p className="mt-1 font-mono text-sm tabular-nums text-fg">
            {player.season.hr} HR · {player.season.pa} PA
          </p>
          <p className="text-xs text-subtle">
            {player.season.avg} / {player.season.slg} / {player.season.ops}
            {player.season.abPerHr ? ` · AB/HR ${player.season.abPerHr}` : ""}
          </p>
        </div>
        <div className="rounded-2xl bg-surface-2 p-3">
          <p className="text-[11px] tracking-wide text-muted uppercase">Last 10</p>
          {player.recent ? (
            <>
              <p className="mt-1 font-mono text-sm tabular-nums text-fg">
                {player.recent.hr} HR · {player.recent.pa} PA
              </p>
              <p className="text-xs text-subtle">{player.recent.games} games</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-subtle">No recent split</p>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-start gap-3 rounded-2xl bg-surface-2 p-3">
        <img src={teamSpot(player.teamId)} alt="" className="mt-0.5 size-7" />
        <div>
          <p className="text-sm text-fg">{player.park.name}</p>
          <p className="text-xs text-subtle">
            {player.park.airLabel}
            {player.weather.condition ? ` · ${player.weather.condition}` : ""}
          </p>
          {parkNote ? <p className="mt-1 text-xs text-muted">{parkNote}</p> : null}
        </div>
      </div>

      {player.lineupSource === "projected" ? (
        <p className="mt-4 text-xs text-subtle">
          Lineup is projected from the last posted card. Official order usually lands 2–3 hours
          before first pitch.
        </p>
      ) : null}
    </div>
  );
}

function TankTiles({ week }: { week: PlayerPrediction["week"] }) {
  const tanks = week?.tanks ?? 0;
  const barrels = week && week.bbe > 0 ? week.barrelPct : null;
  const last = week?.tanksLast1;
  return (
    <div className="mt-3">
      <div className="grid grid-cols-2 gap-2">
        <div className={cn("rounded-2xl px-3 py-3", tanks >= 3 ? "bg-sage-dim" : "bg-surface-2")}>
          <p className="text-[11px] tracking-wide text-muted uppercase">Tanks last 10</p>
          <p className="mt-1 font-mono text-xl tabular-nums text-fg">{tanks}</p>
          <p className={cn("mt-0.5 text-[11px]", last ? "text-sage" : "text-subtle")}>
            {last ? "one last game" : week && week.tanksLast3 > 0 ? `${week.tanksLast3} in last 3` : "102+ · 20–38° · pulled"}
          </p>
        </div>
        <div className="rounded-2xl bg-surface-2 px-3 py-3">
          <p className="text-[11px] tracking-wide text-muted uppercase">Barrels last 10</p>
          <p className="mt-1 font-mono text-xl tabular-nums text-fg">
            {barrels != null ? `${barrels.toFixed(1)}%` : "—"}
          </p>
          <p className="mt-0.5 text-[11px] text-subtle">
            {week && week.bbe > 0 ? `${week.barrels}/${week.bbe} BBE · Statcast window` : "No batted balls"}
          </p>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-subtle">
        A tank is 102+ mph at 20–38° launch, pulled to the power side — the no-doubt ball. Barrels
        are any 98+ mph in Statcast’s launch window, including oppo and 98s. Every tank is a barrel.
        Most barrels are not tanks.
      </p>
    </div>
  );
}

function SignalCard({ player }: { player: PlayerPrediction }) {
  const signal = player.signal;
  const key = signal.keyMatch;
  return (
    <div className="mt-6 rounded-2xl bg-surface-2 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] tracking-[0.14em] text-gold uppercase">Why this look</p>
        <p
          className={cn(
            "text-[11px] font-medium tracking-[0.14em] uppercase",
            gradeClass(signal.grade),
          )}
        >
          {signal.grade} · {signal.passed}/{signal.total}
        </p>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-fg">{signal.why}</p>
      {key ? <KeyMatchTile match={key} lastName={player.lastName || player.name} /> : null}
      <ul className="mt-3 space-y-2">
        {signal.checks.map((c) => (
          <li key={c.key}>
            <RefRow check={c} />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed text-subtle">
        Reference: 12% barrels · .200 xISO · 12% BRL on a 10%+ pitch · 108 air · 1–4 in the order.
        P(HR) is the size. This is why it is a home-run candidate.
      </p>
    </div>
  );
}

function KeyMatchTile({ match, lastName }: { match: KeyPitchMatch; lastName: string }) {
  const usage = `${Math.round(match.usage * 100)}%`;
  const brl =
    match.n >= 4 && match.barrelPct != null ? `${match.barrelPct.toFixed(0)}% BRL` : "no barrel sample";
  return (
    <div
      className={cn(
        "mt-3 rounded-xl px-3 py-2.5",
        match.loud ? "bg-sage-dim" : "bg-bg",
      )}
    >
      <p
        className={cn(
          "text-[10px] font-medium tracking-[0.14em] uppercase",
          match.loud ? "text-sage" : "text-gold",
        )}
      >
        {match.loud ? "Key match" : "Pitch to watch"}
      </p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-fg">
        <span>{match.name}</span>
        <span className="font-normal text-muted">he throws {usage}</span>
      </p>
      <p className={cn("mt-0.5 text-xs", match.loud ? "text-sage" : "text-muted")}>
        {lastName} {brl}
        {match.n >= 4 && match.iso != null ? ` · ${match.iso.toFixed(2)} ISO` : ""}
        {match.n >= 4 && match.ev != null ? ` · ${match.ev.toFixed(0)} EV` : ""}
        {match.hr > 0 ? ` · ${match.hr} HR` : ""}
        {match.n > 0 ? ` · n=${match.n}` : ""}
        {match.loud ? "" : " · 12% cut"}
      </p>
    </div>
  );
}

function RefRow({ check }: { check: HrCheck }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "w-8 shrink-0 text-[10px] font-medium tracking-wide uppercase",
          check.pass ? "text-sage" : "text-subtle",
        )}
      >
        {check.pass ? "on" : "off"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn("text-xs", check.pass ? "text-fg" : "text-muted")}>{check.label}</span>
          <span className="font-mono text-[11px] tabular-nums text-subtle">
            {fmtCheckValue(check)}
            {check.cut != null ? ` / ${fmtCut(check)}` : ""}
          </span>
        </div>
        {check.value != null && check.cut != null ? <CutBar check={check} /> : null}
        <p className="text-[11px] text-subtle">{check.detail}</p>
      </div>
    </div>
  );
}

function CutBar({ check }: { check: HrCheck }) {
  const value = check.value ?? 0;
  const cut = check.cut ?? 1;
  const inverted = check.key === "order";
  const fill = inverted
    ? Math.min(100, Math.max(0, (1 - (value - 1) / Math.max(cut, 1)) * 100))
    : Math.min(100, Math.max(0, (value / (cut * 2)) * 100));
  return (
    <div className="relative mt-1 mb-1 h-1 overflow-hidden rounded-full bg-bg">
      <div
        className={cn("absolute inset-y-0 left-0 rounded-full", check.pass ? "bg-sage/80" : "bg-fg/25")}
        style={{ width: `${fill}%` }}
      />
      <div className="absolute inset-y-0 w-px bg-gold/70" style={{ left: "50%" }} />
    </div>
  );
}

function fmtCheckValue(c: HrCheck): string {
  if (c.value == null) return "—";
  if (c.unit === "%") return `${c.value.toFixed(c.value >= 10 ? 0 : 1)}%`;
  if (c.unit === "×") return c.value.toFixed(2);
  if (c.unit === " air") return String(Math.round(c.value));
  if (c.key === "xiso") return c.value.toFixed(3);
  if (c.key === "order") return `#${c.value}`;
  return String(c.value);
}

function fmtCut(c: HrCheck): string {
  if (c.cut == null) return "";
  if (c.unit === "%") return `${c.cut}%`;
  if (c.unit === "×") return c.cut.toFixed(2);
  if (c.unit === " air") return `${c.cut}`;
  if (c.key === "xiso") return c.cut.toFixed(3);
  if (c.key === "order") return `≤${c.cut}`;
  return String(c.cut);
}

function gradeClass(grade: HrSignal["grade"]): string {
  if (grade === "loud") return "text-sage";
  if (grade === "live") return "text-gold";
  if (grade === "fade") return "text-danger";
  return "text-muted";
}

function MatchupMatrix({ player }: { player: PlayerPrediction }) {
  const mx = player.pitchMatrix;
  if (!mx) return null;
  const pit = player.pitcher;
  const keyCode = player.signal.keyMatch?.code ?? null;
  const keyLoud = player.signal.keyMatch?.loud ?? false;
  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-medium tracking-[0.14em] text-gold uppercase">Matchup matrix</h3>
        <p className="text-[11px] text-subtle">
          Batted balls · {mx.from.slice(5)}–{mx.to.slice(5)}
        </p>
      </div>

      {pit ? (
        <div className="mt-3">
          <PersonRow
            teamId={player.opponentId}
            name={pit.name}
            sub={`${pit.throws}HP · ${player.opponentAbbr}`}
          />
          {mx.pitcher.some((r) => r.n > 0) ? (
            <MixTable rows={mx.pitcher} keyCode={keyCode} keyLoud={keyLoud} />
          ) : (
            <p className="text-xs text-subtle">
              Mix {mx.pitcher.map((r) => `${r.name} ${Math.round(r.pct * 100)}%`).join(" · ") || "—"}
              {" · no batted balls against him in this window yet."}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-subtle">Starter TBD — hitter mix only.</p>
      )}

      <div className="mt-5">
        <PersonRow
          teamId={player.teamId}
          name={player.name}
          sub={`${player.bats}HB · ${player.teamAbbr}`}
        />
        <MixTable rows={mx.hitter} keyCode={keyCode} keyLoud={keyLoud} />
      </div>
    </div>
  );
}

function PersonRow({ teamId, name, sub }: { teamId: number; name: string; sub: string }) {
  return (
    <div className="mb-2 flex items-center gap-2 rounded-xl bg-surface-2 px-2.5 py-2">
      <img src={teamSpot(teamId)} alt="" className="size-7" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-fg">{name}</p>
        <p className="text-[11px] text-muted">{sub}</p>
      </div>
    </div>
  );
}

function MixTable({
  rows,
  keyCode,
  keyLoud,
}: {
  rows: PitchMixRow[];
  keyCode: string | null;
  keyLoud: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-xs text-subtle">No batted balls in window.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-separate border-spacing-y-1 text-[11px]">
        <thead>
          <tr className="text-subtle">
            <th className="pr-2 pb-1 text-left font-medium tracking-wide">Type</th>
            <th className="px-1 pb-1 text-right font-medium">#</th>
            <th className="px-1 pb-1 text-right font-medium">%</th>
            <th className="px-1 pb-1 text-right font-medium">BRL%</th>
            <th className="px-1 pb-1 text-right font-medium">EV</th>
            <th className="px-1 pb-1 text-right font-medium">ISO</th>
            <th className="px-1 pb-1 text-right font-medium">wOBA</th>
            <th className="pl-1 pb-1 text-right font-medium">HR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const marked = keyCode != null && r.code === keyCode;
            return (
              <tr
                key={r.code}
                className={cn(
                  marked && keyLoud && "bg-sage-dim",
                  marked && !keyLoud && "bg-gold/10",
                )}
              >
                <td
                  className={cn(
                    "pr-2 font-medium text-fg",
                    marked && keyLoud && "border-l-2 border-sage pl-1.5",
                    marked && !keyLoud && "border-l-2 border-gold pl-1.5",
                  )}
                >
                  {r.name}
                  {marked ? (
                    <span
                      className={cn(
                        "ml-1.5 text-[9px] font-medium tracking-wide uppercase",
                        keyLoud ? "text-sage" : "text-gold",
                      )}
                    >
                      {keyLoud ? "key" : "watch"}
                    </span>
                  ) : null}
                </td>
                <td className="px-1 text-right font-mono tabular-nums text-muted">{r.n || "—"}</td>
                <td className="px-1 text-right font-mono tabular-nums text-muted">
                  {r.pct > 0 ? `${Math.round(r.pct * 100)}%` : "—"}
                </td>
                <td>
                  <ToneCell
                    text={r.n === 0 || r.barrelPct == null ? "—" : `${r.barrelPct.toFixed(1)}%`}
                    tone={r.n === 0 ? "flat" : toneOf("barrel", r.barrelPct)}
                  />
                </td>
                <td>
                  <ToneCell
                    text={r.n === 0 || r.ev == null ? "—" : r.ev.toFixed(1)}
                    tone={r.n === 0 ? "flat" : toneOf("ev", r.ev)}
                  />
                </td>
                <td>
                  <ToneCell
                    text={r.n === 0 || r.iso == null ? "—" : r.iso.toFixed(2)}
                    tone={r.n === 0 ? "flat" : toneOf("iso", r.iso)}
                  />
                </td>
                <td>
                  <ToneCell
                    text={r.n === 0 || r.woba == null ? "—" : r.woba.toFixed(2)}
                    tone={r.n === 0 ? "flat" : toneOf("woba", r.woba)}
                  />
                </td>
                <td>
                  <ToneCell
                    text={r.n === 0 ? "—" : String(r.hr)}
                    tone={r.n === 0 ? "flat" : toneOf("hr", r.hr)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ToneCell({ text, tone }: { text: string; tone: "up" | "down" | "flat" }) {
  return (
    <div
      className={cn(
        "rounded-md px-1.5 py-1 text-right font-mono tabular-nums",
        tone === "up" && "bg-sage-dim text-sage",
        tone === "down" && "bg-danger/20 text-danger",
        tone === "flat" && "text-muted",
      )}
    >
      {text}
    </div>
  );
}

function toneOf(
  kind: "barrel" | "ev" | "iso" | "woba" | "hr",
  value: number | null,
): "up" | "down" | "flat" {
  if (value == null || (kind !== "hr" && !Number.isFinite(value))) return "flat";
  if (kind === "barrel") return value >= 10 ? "up" : value < 5 ? "down" : "flat";
  if (kind === "ev") return value >= 91 ? "up" : value < 88 ? "down" : "flat";
  if (kind === "iso") return value >= 0.18 ? "up" : value < 0.1 ? "down" : "flat";
  if (kind === "woba") return value >= 0.36 ? "up" : value < 0.3 ? "down" : "flat";
  return value >= 1 ? "up" : "down";
}

function StarterMissBats({
  pitcher,
  tbf,
}: {
  pitcher: PitcherInfo;
  tbf: number;
}) {
  const k = pitcher.kPct;
  const whiff = pitcher.whiffPct;
  const whip = pitcher.whip;
  const kLift = k != null && k <= 19;
  const kFade = k != null && k >= 28;
  return (
    <div className="mt-2 rounded-2xl bg-surface-2 p-3">
      <p className="text-[11px] tracking-wide text-muted uppercase">Starter miss bats</p>
      <p className="mt-1 font-mono text-sm tabular-nums text-fg">
        {`${tbf.toFixed(1)} TBF / start`}
        {k != null ? ` · ${k.toFixed(1)}% K` : ""}
        {whiff != null ? ` · ${whiff.toFixed(1)}% whiff` : ""}
        {whip != null ? ` · ${whip.toFixed(2)} WHIP` : ""}
      </p>
      <p className="text-xs text-subtle">
        {kLift
          ? "Low K — more balls in play, more HR chances at the same barrel rate."
          : kFade
            ? "Misses bats. Barrels still count; volume of contact is thinner."
            : "K% is the volume term. WHIP is traffic, not air — shown, not stacked into P(HR)."}
      </p>
    </div>
  );
}

function HandSplitLine({ player }: { player: PlayerPrediction }) {
  const hand = player.pitcher?.throws === "L" ? "L" : player.pitcher?.throws === "R" ? "R" : null;
  const split = hand === "L" ? player.handSplit?.vsL : hand === "R" ? player.handSplit?.vsR : null;
  const week = hand === "L" ? player.week?.vsL : hand === "R" ? player.week?.vsR : null;
  if (!hand) {
    return <p className="mt-1 text-sm text-subtle">Starter TBD</p>;
  }
  return (
    <>
      {week && week.bbe > 0 ? (
        <p className="mt-1 font-mono text-sm tabular-nums text-fg">
          {week.pct != null ? `${week.pct.toFixed(1)}%` : "—"} barrels last 7
        </p>
      ) : (
        <p className="mt-1 font-mono text-sm tabular-nums text-fg">vs {hand}HP</p>
      )}
      <p className="text-xs text-subtle">
        {split ? `${split.hr} HR / ${split.pa} PA season · ${split.slg} SLG` : "Thin split"}
        {week ? ` · ${week.barrels}/${week.bbe} BBE` : ""}
        {player.pitcher?.mixLabel ? ` · ${player.pitcher.mixLabel}` : ""}
      </p>
    </>
  );
}

function SavantCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] tracking-wide text-subtle uppercase">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm tabular-nums text-fg">{value}</dd>
    </div>
  );
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-surface-2 px-3 py-3">
      <p className="text-[11px] tracking-wide text-muted uppercase">{label}</p>
      <p
        className={cn(
          "mt-1 font-mono text-xl tabular-nums",
          accent ? "text-fg" : "text-fg",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function FactorBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, ((value - 0.7) / 0.8) * 100));
  const mid = ((1 - 0.7) / 0.8) * 100;
  return (
    <div className="relative h-1.5 overflow-hidden rounded-full bg-bg">
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-accent/80"
        style={{ width: `${pct}%` }}
      />
      <div
        className="absolute inset-y-0 w-px bg-fg/35"
        style={{ left: `${mid}%` }}
      />
    </div>
  );
}
