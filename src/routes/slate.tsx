import { createFileRoute } from "@tanstack/react-router";
import { PendingBoard } from "@/components/pending-board";
import { Shell } from "@/components/shell";
import { SlateView } from "@/components/slate-view";
import { getBoard } from "@/lib/mlb/get-board";
import { parseDateSearch } from "@/lib/search";

export const Route = createFileRoute("/slate")({
  validateSearch: parseDateSearch,
  loaderDeps: ({ search }) => ({ date: search.date }),
  loader: ({ deps }) => getBoard({ data: { date: deps.date } }),
  pendingComponent: PendingBoard,
  component: SlatePage,
});

function SlatePage() {
  const board = Route.useLoaderData();
  return (
    <Shell date={board.date}>
      <SlateView board={board} />
    </Shell>
  );
}
