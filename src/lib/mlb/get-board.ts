import { createServerFn } from "@tanstack/react-start";
import type { BoardPayload, WalkForward } from "./types";

export const getBoard = createServerFn({ method: "GET" })
  .validator((data: { date?: string }) => data)
  .handler(async ({ data }): Promise<BoardPayload> => {
    const { loadBoard } = await import("./board.server");
    return loadBoard(data.date);
  });

export const getWalkForward = createServerFn({ method: "GET" })
  .validator((data: { date?: string }) => data)
  .handler(async ({ data }): Promise<WalkForward | null> => {
    const { loadWalkForward } = await import("./walk-forward");
    const { todayISODateET } = await import("./format");
    const date =
      data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : todayISODateET();
    return loadWalkForward(date);
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
