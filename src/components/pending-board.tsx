import { Shell } from "./shell";
import { Skeleton } from "./ui/skeleton";
import { todayISODateET } from "@/lib/mlb/format";

export function PendingBoard() {
  return (
    <Shell date={todayISODateET()}>
      <div className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-12 w-72" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-40 rounded-3xl" />
          <Skeleton className="h-40 rounded-3xl" />
          <Skeleton className="h-40 rounded-3xl" />
        </div>
        <Skeleton className="h-96 rounded-3xl" />
      </div>
    </Shell>
  );
}
