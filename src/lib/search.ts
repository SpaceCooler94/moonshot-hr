import { isValidISODate } from "./mlb/format";

export type DateSearch = {
  date?: string;
  q?: string;
  team?: string;
  stable?: "1";
};

export function parseDateSearch(s: Record<string, unknown>): DateSearch {
  return {
    date: isValidISODate(s.date as string | undefined) ? (s.date as string) : undefined,
    q: typeof s.q === "string" && s.q.length < 80 ? s.q : undefined,
    team: typeof s.team === "string" && s.team.length <= 4 ? s.team : undefined,
    stable: s.stable === "1" ? "1" : undefined,
  };
}
