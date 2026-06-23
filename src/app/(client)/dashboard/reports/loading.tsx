import { Skeleton, SkeletonHeader } from "@/components/ui/skeleton";

export default function ReportsLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />
      <div className="grid gap-6 xl:grid-cols-2">
        <Skeleton className="h-56 w-full rounded-2xl" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    </div>
  );
}
