import { SkeletonHeader, SkeletonList } from "@/components/ui/skeleton";

export default function ContractsLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />
      <SkeletonList rows={3} />
    </div>
  );
}
