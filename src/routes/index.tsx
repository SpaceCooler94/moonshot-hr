import { createFileRoute } from "@tanstack/react-router";
import { BoardView } from "@/components/board-view";
import { PendingBoard } from "@/components/pending-board";
import { Shell } from "@/components/shell";
import { getBoard } from "@/lib/mlb/get-board";
import { parseDateSearch } from "@/lib/search";

export const Route = createFileRoute("/")({
  validateSearch: parseDateSearch,
  loaderDeps: ({ search }) => ({ date: search.date }),
  loader: ({ deps }) => getBoard({ data: { date: deps.date } }),
  pendingComponent: PendingBoard,
  component: Home,
});

function Home() {
  const board = Route.useLoaderData();
  const { q, team, stable } = Route.useSearch();
  return (
    <Shell date={board.date}>
      <BoardView board={board} query={q} team={team} stable={stable === "1"} />
    </Shell>
  );
}
