import { Skeleton, SkeletonHeader } from "@/components/ui/skeleton";

export default function UpdatesLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />
      <div className="max-w-3xl space-y-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
            <Skeleton className="h-28 flex-1 rounded-2xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
