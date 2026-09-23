"use client";

import { useEffect, useState } from "react";
import { ODDS_KEY_LS, SGO_KEY_LS } from "@/lib/mlb/get-board";
import { Button } from "./ui/button";

export function OddsKeyCard() {
  const [sgo, setSgo] = useState("");
  const [odds, setOdds] = useState("");
  const [saved, setSaved] = useState(false);
  const [hasSgo, setHasSgo] = useState(false);
  const [hasOdds, setHasOdds] = useState(false);
  const [left, setLeft] = useState<string | null>(null);
  useEffect(() => {
    setHasSgo((localStorage.getItem(SGO_KEY_LS) ?? "").length >= 8);
    setHasOdds((localStorage.getItem(ODDS_KEY_LS) ?? "").length >= 8);
    setLeft(localStorage.getItem("moonshot.oddsLeft"));
  }, []);

  function persist() {
    const s = sgo.trim();
    const o = odds.trim();
    if (s.length >= 8) {
      localStorage.setItem(SGO_KEY_LS, s);
      setHasSgo(true);
    }
    if (o.length >= 8) {
      localStorage.setItem(ODDS_KEY_LS, o);
      setHasOdds(true);
    }
    setSgo("");
    setOdds("");
    setSaved(true);
  }

  return (
    <section className="mt-8 rounded-3xl bg-surface px-5 py-5 shadow-hair">
      <p className="text-[11px] font-medium tracking-[0.22em] text-gold uppercase">Books key</p>
      <h2 className="mt-1 font-display text-2xl">SportsGameOdds</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        The Odds API credits are gone. This is the books feed now. Paste the key emailed after the
        trial (Model, then Board). Market is{" "}
        <span className="text-fg">batting_homeRuns</span> yes/over. Soft row = FanDuel / DraftKings /
        BetMGM / Caesars. Sharp row = Pinnacle / Circa / LowVig / BetOnline / Bookmaker.eu — dashes
        mean that book is not posting 1+ HR, not a dead key.
      </p>
      <label className="mt-4 block">
        <span className="text-[11px] tracking-wide text-subtle uppercase">
          {hasSgo ? "Replace SportsGameOdds key" : "SportsGameOdds API key"}
        </span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={sgo}
          onChange={(e) => {
            setSgo(e.target.value);
            setSaved(false);
          }}
          placeholder={hasSgo ? "Key saved on this device" : "Paste SGO key"}
          className="mt-1 h-11 w-full rounded-xl border border-border bg-bg px-3 font-mono text-sm text-fg outline-none focus:border-gold"
        />
      </label>
      <label className="mt-3 block">
        <span className="text-[11px] tracking-wide text-subtle uppercase">
          {hasOdds ? "Replace Odds API key (backup)" : "The Odds API key (backup)"}
        </span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={odds}
          onChange={(e) => {
            setOdds(e.target.value);
            setSaved(false);
          }}
          placeholder={hasOdds ? "Key saved on this device" : "Optional"}
          className="mt-1 h-11 w-full rounded-xl border border-border bg-bg px-3 font-mono text-sm text-fg outline-none focus:border-gold"
        />
      </label>
      <div className="mt-3 flex items-center gap-2">
        <Button type="button" onClick={persist}>
          Save on this device
        </Button>
        {hasSgo || hasOdds ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              localStorage.removeItem(SGO_KEY_LS);
              localStorage.removeItem(ODDS_KEY_LS);
              setHasSgo(false);
              setHasOdds(false);
              setSgo("");
              setOdds("");
              setSaved(true);
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-subtle">
        {saved
          ? hasSgo || hasOdds
            ? "Saved. Open the Board — lines load for tonight."
            : "Cleared."
          : hasSgo
            ? "SportsGameOdds key is saved here."
            : hasOdds
              ? "Odds API backup is saved here."
              : "No key yet."}
        {left != null ? ` · Odds API ${left} credits left.` : ""}
      </p>
    </section>
  );
}
