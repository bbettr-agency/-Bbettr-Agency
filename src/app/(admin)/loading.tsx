import { Skeleton, SkeletonHeader, SkeletonList } from "@/components/ui/skeleton";

/**
 * Group-level skeleton for admin pages without their own loading boundary
 * (overview, clients, invoices, files, updates, reps, settings). Keeps every
 * admin transition instant; data-heavy routes (client detail) define their own.
 */
export default function AdminLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-20 rounded-2xl" />
      </div>
      <SkeletonList rows={4} />
    </div>
  );
}
