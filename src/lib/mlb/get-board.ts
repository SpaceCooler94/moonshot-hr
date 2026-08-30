import { createServerFn } from "@tanstack/react-start";
import type { BoardPayload, PlayerPrediction, WalkForward } from "./types";

export const getBoard = createServerFn({ method: "GET" })
  .validator((data: { date?: string }) => data)
  .handler(async ({ data }): Promise<BoardPayload> => {
    const { loadBoard } = await import("./board.server");
    const board = await loadBoard(data.date);
    return slimBoard(board);
  });

export const getPlayer = createServerFn({ method: "GET" })
  .validator((data: { date?: string; playerId: number; gamePk: number }) => data)
  .handler(async ({ data }): Promise<PlayerPrediction | null> => {
    const { loadBoard } = await import("./board.server");
    const board = await loadBoard(data.date);
    return (
      board.predictions.find((p) => p.playerId === data.playerId && p.gamePk === data.gamePk) ??
      null
    );
  });

export const getWalkForward = createServerFn({ method: "GET" })
  .validator((data: { date?: string; fill?: boolean }) => data)
  .handler(async ({ data }): Promise<WalkForward | null> => {
    const { loadWalkForward } = await import("./walk-forward");
    const { todayISODateET } = await import("./format");
    const date =
      data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : todayISODateET();
    return loadWalkForward(date, { fill: data.fill === true });
  });

export const bustBoard = createServerFn({ method: "POST" })
  .validator((data: { date?: string }) => data)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { bustBoardCache } = await import("./board.server");
    const { todayISODateET } = await import("./format");
    const date =
      data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : todayISODateET();
    bustBoardCache(date);
    return { ok: true };
  });

function slimBoard(board: BoardPayload): BoardPayload {
  return {
    ...board,
    predictions: board.predictions.map(slimPlayer),
  };
}

function slimPlayer(p: PlayerPrediction): PlayerPrediction {
  const mx = p.pitchMatrix;
  const keep = mx
    ? mx.pitcher.filter((r) => r.pct >= 0.08).slice(0, 4)
    : [];
  const codes = new Set(keep.map((r) => r.code));
  return {
    ...p,
    pitchMatrix: mx
      ? {
          from: mx.from,
          to: mx.to,
          pitcher: keep,
          hitter: mx.hitter.filter((h) => codes.has(h.code)),
        }
      : null,
    week: p.week
      ? {
          ...p.week,
          vsPitch: [],
          vsHard: { bbe: 0, barrels: 0, pct: null },
          vsBreak: { bbe: 0, barrels: 0, pct: null },
          vsOff: { bbe: 0, barrels: 0, pct: null },
          heart: p.week.heart,
          chase: p.week.chase,
        }
      : null,
    signal: {
      ...p.signal,
      checks: [],
      why: p.signal.why,
    },
  };
}
