export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(s: unknown): s is string {
  return typeof s === "string" && DATE_RE.test(s);
}

export function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

export function asRecord(v: unknown): Record<string, unknown> | null {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

export type WalkDayRaw = {
  date: string;
  looks: unknown[];
  games: number | null;
  lockStatus: string | null;
};

export function parseWalkDays(raw: unknown): WalkDayRaw[] {
  const days = asArray(raw);
  if (!days) return [];
  const out: WalkDayRaw[] = [];
  for (const d of days) {
    const rec = asRecord(d);
    if (!rec) continue;
    if (typeof rec.date !== "string" || !DATE_RE.test(rec.date)) continue;
    const looks = asArray(rec.looks);
    if (!looks || looks.length === 0) continue;
    out.push({
      date: rec.date,
      looks,
      games: Number.isFinite(rec.games) ? Number(rec.games) : null,
      lockStatus: typeof rec.lockStatus === "string" ? rec.lockStatus : null,
    });
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchOk(
  url: string,
  init?: RequestInit,
  timeoutMs = 12_000,
): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (res.ok) return res;
      if ((res.status === 429 || res.status >= 500) && attempt === 0) {
        await sleep(400);
        last = new Error(`http ${res.status}`);
        continue;
      }
      return res;
    } catch (err) {
      last = err;
      if (attempt === 0) {
        await sleep(400);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(t);
    }
  }
  throw last instanceof Error ? last : new Error("fetch failed");
}

export async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 12_000): Promise<T> {
  const { headers, ...rest } = init ?? {};
  const res = await fetchOk(
    url,
    {
      ...rest,
      headers: { Accept: "application/json", ...(headers as HeadersInit) },
    },
    timeoutMs,
  );
  if (!res.ok) throw new Error(`http ${res.status}`);
  const raw: unknown = await res.json();
  if (raw === null || typeof raw !== "object") throw new Error("json not object");
  return raw as T;
}

export function pruneMap<T extends { exp: number }>(m: Map<string, T>, max = 80): void {
  const now = Date.now();
  for (const [k, v] of m) if (v.exp <= now) m.delete(k);
  if (m.size <= max) return;
  const extra = m.size - max;
  let n = 0;
  for (const k of m.keys()) {
    m.delete(k);
    if (++n >= extra) break;
  }
}