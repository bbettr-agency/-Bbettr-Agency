import { Skeleton, SkeletonHeader } from "@/components/ui/skeleton";

export default function ProjectLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <Skeleton className="h-12 flex-1 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
