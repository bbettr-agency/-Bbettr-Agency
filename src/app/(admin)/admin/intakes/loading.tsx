import { Skeleton } from "@/components/ui/skeleton";

export default function IntakesLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-9 w-56" />
      <div className="space-y-2 rounded-2xl border border-ink-100 bg-white p-4 shadow-sm">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
