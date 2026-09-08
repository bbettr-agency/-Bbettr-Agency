import type { ProgressView } from "@/lib/prospect/intake-steps";

/**
 * Slim, calm progress indicator for the public intake (P2-A foundation).
 * Shows the current section label + a stable "N of 6" (the denominator never
 * changes, even when "A few details" is skipped) + a subtle bar.
 */
export function IntakeProgress({ progress }: { progress: ProgressView }) {
  const pct = Math.round(progress.fraction * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium text-ink-700">{progress.label}</p>
        <p className="text-xs tabular-nums text-ink-400">
          {progress.index} of {progress.count}
        </p>
      </div>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-ink-100">
        <div
          className="h-full rounded-full bg-brand-500 transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={progress.index}
          aria-valuemin={1}
          aria-valuemax={progress.count}
          aria-label={`Section ${progress.index} of ${progress.count}: ${progress.label}`}
        />
      </div>
    </div>
  );
}
