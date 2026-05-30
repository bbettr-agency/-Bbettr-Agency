import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectStage } from "@/lib/database.types";

/**
 * Vertical progress tracker used on the client dashboard & project page.
 * Renders the stage timeline with completed / in-progress / pending states.
 */
export function ProgressTracker({ stages }: { stages: ProjectStage[] }) {
  const ordered = [...stages].sort((a, b) => a.position - b.position);

  return (
    <ol className="relative">
      {ordered.map((stage, i) => {
        const isLast = i === ordered.length - 1;
        return (
          <li key={stage.id} className="relative flex gap-4 pb-6 last:pb-0">
            {/* connector line */}
            {!isLast && (
              <span
                className={cn(
                  "absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-0.5",
                  stage.status === "completed" ? "bg-brand-500" : "bg-ink-200"
                )}
                aria-hidden
              />
            )}
            <StageMarker status={stage.status} />
            <div className="pt-0.5">
              <p
                className={cn(
                  "text-sm font-semibold",
                  stage.status === "pending" ? "text-ink-400" : "text-ink-900"
                )}
              >
                {stage.name}
              </p>
              {stage.description && (
                <p className="mt-0.5 text-xs text-ink-500">{stage.description}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StageMarker({ status }: { status: ProjectStage["status"] }) {
  if (status === "completed") {
    return (
      <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white shadow-brand">
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600 ring-4 ring-amber-50">
        <Loader2 className="h-4 w-4 animate-spin" />
      </span>
    );
  }
  return (
    <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink-200 bg-white text-ink-300">
      <span className="h-2 w-2 rounded-full bg-current" />
    </span>
  );
}

/** Compact linear progress bar (0–100). */
export function ProgressBar({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-ink-100", className)}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
