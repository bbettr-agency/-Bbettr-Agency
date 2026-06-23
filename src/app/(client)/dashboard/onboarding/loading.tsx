import { Skeleton, SkeletonHeader } from "@/components/ui/skeleton";

export default function OnboardingLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />
      {/* Service tabs */}
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-32 rounded-xl" />
        ))}
      </div>
      {/* Progress + accordion form */}
      <Skeleton className="h-16 w-full rounded-2xl" />
      <Skeleton className="h-96 w-full rounded-2xl" />
    </div>
  );
}
