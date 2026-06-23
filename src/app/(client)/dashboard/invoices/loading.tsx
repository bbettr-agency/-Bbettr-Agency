import { SkeletonHeader, SkeletonList } from "@/components/ui/skeleton";

export default function InvoicesLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />
      <SkeletonList rows={4} />
    </div>
  );
}
