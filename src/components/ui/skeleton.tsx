import { cn } from "@/lib/utils";

/**
 * Lightweight skeleton primitives for route `loading.tsx` boundaries. Purely
 * presentational — they give instant, shaped feedback during navigation so a
 * route transition never shows a dead pause. No data, no behaviour.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-ink-100", className)}
      aria-hidden
    />
  );
}

/** Mirrors a PageHeader (title + description). */
export function SkeletonHeader() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-52" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}

/** A stack of full-width card placeholders. */
export function SkeletonList({
  rows = 3,
  height = "h-20",
}: {
  rows?: number;
  height?: string;
}) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn("w-full rounded-2xl", height)} />
      ))}
    </div>
  );
}
