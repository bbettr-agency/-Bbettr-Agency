import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton for the data-heavy admin client-detail page. */
export default function ClientDetailLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-28" /> {/* back link */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" /> {/* avatar */}
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      {/* Tab bar */}
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-xl" />
        ))}
      </div>
      {/* Tab content */}
      <Skeleton className="h-96 w-full rounded-2xl" />
    </div>
  );
}
