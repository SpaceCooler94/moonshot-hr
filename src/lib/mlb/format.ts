export function todayISODateET(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function shiftISODate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Inclusive ET midnight → next ET midnight as ISO-8601 with offset. */
export function etDayBoundsIso(date: string): { after: string; before: string } {
  const off = etOffsetAt(date);
  return { after: `${date}T00:00:00${off}`, before: `${shiftISODate(date, 1)}T00:00:00${off}` };
}

function etOffsetAt(date: string): string {
  const probe = new Date(`${date}T16:00:00.000Z`);
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  }).format(probe);
  const m = s.match(/GMT([+-])(\d+)/i);
  if (!m) return "-04:00";
  return `${m[1]}${m[2].padStart(2, "0")}:00`;
}

export function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

export function formatGameTime(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(dt);
}

export function formatPct(p: number, digits = 1): string {
  return `${(p * 100).toFixed(digits)}%`;
}

export function formatLockClock(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatXhr(x: number): string {
  return x.toFixed(2);
}

export function formatFactor(v: number): string {
  const pct = (v - 1) * 100;
  const rounded = Math.round(pct);
  if (rounded === 0) return "even";
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

export function playerHeadshot(id: number): string {
  return `https://midfield.mlbstatic.com/v1/people/${id}/spots/132`;
}

export function teamSpot(id: number): string {
  return `https://midfield.mlbstatic.com/v1/team/${id}/spots/60`;
}

export function formatAmerican(odds: number): string {
  const n = Math.round(odds);
  return n > 0 ? `+${n}` : String(n);
}

export function formatEv(ev: number): string {
  const pct = Math.round(ev * 100);
  return `${pct > 0 ? "+" : ""}${pct}% EV`;
}

export function isValidISODate(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
