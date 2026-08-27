import { MODEL_VERSION } from "./model";
import { todayISODateET } from "./format";
import type { BoardPayload, LockLook, LockRecord, LockState } from "./types";

const mem = new Map<string, LockRecord>();

function lockKey(date: string) {
  return `${MODEL_VERSION}:${date}`;
}

export function readLock(date: string): LockRecord | null {
  return mem.get(lockKey(date)) ?? null;
}

export function writeLock(record: LockRecord): LockRecord {
  mem.set(lockKey(record.date), record);
  return record;
}

export function canLock(board: BoardPayload): boolean {
  if (board.date !== todayISODateET()) return false;
  if (board.summary.games < 1 || board.summary.modeled < 9) return false;
  const underway = board.summary.completedGames + board.summary.liveGames > 0;
  const ninesUp = board.summary.officialLineups === board.summary.games;
  return ninesUp || underway;
}

export function lockFromBoard(board: BoardPayload): LockRecord {
  const looks: LockLook[] = board.predictions.map((p, i) => ({
    playerId: p.playerId,
    gamePk: p.gamePk,
    pHr: p.pHr,
    pHrRaw: p.pHrRaw,
    rank: i + 1,
  }));
  return {
    date: board.date,
    model: MODEL_VERSION,
    lockedAt: new Date().toISOString(),
    looks,
  };
}

export function lockState(board: BoardPayload, lock: LockRecord | null): LockState {
  if (lock) {
    return {
      status: "locked",
      at: lock.lockedAt,
      model: lock.model,
      note: "P(HR) frozen at lock. Boxes still update.",
    };
  }
  if (board.date < todayISODateET()) {
    return {
      status: "rebuilt",
      at: null,
      model: MODEL_VERSION,
      note: "No lock that night — scored from a rebuild. Season rates can leak that day’s contact.",
    };
  }
  return {
    status: "open",
    at: null,
    model: MODEL_VERSION,
    note: "Lineups still moving. P(HR) can change until the nines are official or a game is live.",
  };
}
