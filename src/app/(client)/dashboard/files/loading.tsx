import { Skeleton, SkeletonHeader } from "@/components/ui/skeleton";

export default function FilesLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />
      {/* Upload zone */}
      <Skeleton className="h-32 w-full rounded-2xl" />
      {/* Grouped file lists */}
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
    </div>
  );
}
