import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MODEL_VERSION } from "./model";
import { todayISODateET } from "./format";
import type { BoardPayload, LockLook, LockRecord, LockState } from "./types";

const mem = new Map<string, LockRecord>();
const DATA_DIR = join(process.cwd(), "data", "locks");
let hydrated = false;

function storePath() {
  return join(DATA_DIR, `${MODEL_VERSION}.json`);
}

function lockKey(date: string) {
  return `${MODEL_VERSION}:${date}`;
}

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = JSON.parse(readFileSync(storePath(), "utf8")) as LockRecord[];
    if (!Array.isArray(raw)) return;
    for (const r of raw) {
      if (r?.date && r.looks?.length) mem.set(lockKey(r.date), r);
    }
  } catch {
    /* first run or read-only host */
  }
}

function flush() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const path = storePath();
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify([...mem.values()]));
    renameSync(tmp, path);
  } catch {
    /* Vercel / read-only — memory still holds this process */
  }
}

export function readLock(date: string): LockRecord | null {
  hydrate();
  return mem.get(lockKey(date)) ?? null;
}

export function writeLock(record: LockRecord): LockRecord {
  hydrate();
  mem.set(lockKey(record.date), record);
  flush();
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
      note: "P(HR) frozen at first lock. Mix/week are exclusive of this date. Boxes still update.",
    };
  }
  if (board.date < todayISODateET()) {
    return {
      status: "rebuilt",
      at: null,
      model: MODEL_VERSION,
      note: "No lock on disk for this night. Mix/week stop before this date; season totals can still include it.",
    };
  }
  return {
    status: "open",
    at: null,
    model: MODEL_VERSION,
    note: "Lineups still moving. P(HR) can change until the nines are official or a game is live.",
  };
}
