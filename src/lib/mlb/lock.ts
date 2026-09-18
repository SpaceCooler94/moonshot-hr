import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MODEL_VERSION } from "./prob";
import { todayISODateET } from "./format";
import type { BoardPayload, GameCard, LockLook, LockRecord, LockState, PlayerPrediction } from "./types";

const mem = new Map<string, LockRecord>();

function lockKey(date: string) {
  return `${MODEL_VERSION}:${date}`;
}

export function lockDir() {
  return join(process.cwd(), "data", "daily");
}

export function lockPath(date: string) {
  return join(lockDir(), `lock-${date}.json`);
}

function readDisk(date: string): LockRecord | null {
  try {
    const raw = readFileSync(lockPath(date), "utf8");
    const rec = JSON.parse(raw) as LockRecord;
    if (!rec || rec.date !== date || !Array.isArray(rec.looks)) return null;
    return rec;
  } catch {
    return null;
  }
}

function writeDisk(record: LockRecord) {
  try {
    mkdirSync(lockDir(), { recursive: true });
    writeFileSync(lockPath(record.date), JSON.stringify(record));
  } catch {
    /* read-only host — memory still holds the lock this process */
  }
}

export function readLock(date: string): LockRecord | null {
  const hit = mem.get(lockKey(date));
  if (hit) return hit;
  const disk = readDisk(date);
  if (disk) mem.set(lockKey(date), disk);
  return disk;
}

export function writeLock(record: LockRecord): LockRecord {
  mem.set(lockKey(record.date), record);
  writeDisk(record);
  return record;
}

export function gameIsLockable(game: Pick<GameCard, "status" | "lineupSource">): boolean {
  return game.lineupSource === "official" || game.status === "live" || game.status === "final";
}

/** First freeze when any official nine is up or a game is underway. */
export function canLock(board: BoardPayload): boolean {
  if (board.date > todayISODateET()) return false;
  if (board.summary.games < 1 || board.summary.modeled < 9) return false;
  const underway = board.summary.completedGames + board.summary.liveGames > 0;
  const anyOfficial = board.games.some((g) => g.lineupSource === "official");
  return anyOfficial || underway;
}

export function lockFromBoard(board: BoardPayload, games?: GameCard[]): LockRecord {
  const lockable = new Set(
    (games ?? board.games).filter(gameIsLockable).map((g) => g.gamePk),
  );
  const pool =
    lockable.size > 0
      ? board.predictions.filter((p) => lockable.has(p.gamePk))
      : board.predictions;
  const looks: LockLook[] = [...pool]
    .sort((a, b) => b.pHr - a.pHr)
    .map((p, i) => ({
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

/** Keep frozen P; append looks from games that just became lockable. */
export function mergeLock(
  existing: LockRecord,
  board: BoardPayload,
  predictions: PlayerPrediction[],
): LockRecord {
  const byKey = new Map<string, LockLook>(
    existing.looks.map((l) => [`${l.playerId}:${l.gamePk}`, l]),
  );
  const lockable = new Set(board.games.filter(gameIsLockable).map((g) => g.gamePk));
  let added = 0;
  for (const p of predictions) {
    const key = `${p.playerId}:${p.gamePk}`;
    if (byKey.has(key)) continue;
    if (!lockable.has(p.gamePk)) continue;
    byKey.set(key, {
      playerId: p.playerId,
      gamePk: p.gamePk,
      pHr: p.pHr,
      pHrRaw: p.pHrRaw,
      rank: 0,
    });
    added += 1;
  }
  if (added === 0) return existing;
  const looks = [...byKey.values()]
    .sort((a, b) => b.pHr - a.pHr)
    .map((l, i) => ({ ...l, rank: i + 1 }));
  return writeLock({
    date: existing.date,
    model: existing.model || MODEL_VERSION,
    lockedAt: existing.lockedAt,
    looks,
  });
}

export function applyLock(predictions: PlayerPrediction[], lock: LockRecord): void {
  const byKey = new Map<string, LockLook>(
    lock.looks.map((l) => [`${l.playerId}:${l.gamePk}`, l]),
  );
  for (const p of predictions) {
    const hit = byKey.get(`${p.playerId}:${p.gamePk}`);
    if (hit) {
      p.pHr = hit.pHr;
      p.pHrRaw = hit.pHrRaw;
    }
  }
}

export function lockState(board: BoardPayload, lock: LockRecord | null): LockState {
  if (lock) {
    const lockedGames = new Set(lock.looks.map((l) => l.gamePk));
    const open = board.games.filter((g) => !lockedGames.has(g.gamePk)).length;
    return {
      status: "locked",
      at: lock.lockedAt,
      model: lock.model,
      note:
        open > 0
          ? `P(HR) frozen on ${lock.looks.length} looks. ${open} game${open === 1 ? "" : "s"} still open for weather / nines.`
          : "P(HR) frozen at lock. Boxes still update.",
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
    note: "Lineups still moving. P(HR) can change until a game’s nines are official or it goes live.",
  };
}
