import { Skeleton } from "@/components/ui/skeleton";

/** Instant skeleton for the dashboard while its data loads. */
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Welcome hero */}
      <Skeleton className="h-44 w-full rounded-2xl" />

      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-2xl lg:col-span-2" />
        <div className="space-y-6">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      </div>

      <Skeleton className="h-40 w-full rounded-2xl" />
    </div>
  );
}
