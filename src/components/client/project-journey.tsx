import { Check } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { ProjectStage } from "@/lib/database.types";
import { toClientJourney, type JourneyStatus } from "@/lib/journey";

/**
 * Premium client-facing project journey. A horizontal stepper on desktop, a
 * vertical timeline on mobile — rendered from the client-facing journey mapping
 * (presentation only; internal stages are untouched). The active step glows.
 */
export function ProjectJourney({ stages }: { stages: ProjectStage[] }) {
  const journey = toClientJourney(stages);
  if (journey.length === 0) return null;

  return (
    <ol className="flex flex-col gap-5 sm:flex-row sm:gap-0">
      {journey.map((step, i) => {
        const last = i === journey.length - 1;
        return (
          <li
            key={`${step.internalName}-${i}`}
            className="relative flex flex-1 items-start gap-4 sm:flex-col sm:items-center sm:gap-3 sm:text-center"
          >
            {/* Connector to the next step */}
            {!last && (
              <>
                {/* vertical (mobile) */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-[15px] top-9 h-[calc(100%+0.25rem)] w-0.5 sm:hidden",
                    step.status === "completed" ? "bg-brand-500" : "bg-ink-200"
                  )}
                />
                {/* horizontal (desktop) */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-1/2 top-4 hidden h-0.5 w-full sm:block",
                    step.status === "completed" ? "bg-brand-500" : "bg-ink-200"
                  )}
                />
              </>
            )}

            <Marker status={step.status} />

            <div className="pt-0.5 sm:pt-0">
              <p
                className={cn(
                  "text-sm font-semibold",
                  step.status === "pending" ? "text-ink-400" : "text-ink-900"
                )}
              >
                {step.label}
              </p>
              {step.status === "in_progress" && (
                <p className="mt-0.5 text-xs font-medium text-amber-600">
                  In progress
                </p>
              )}
              {step.targetDate && step.status !== "completed" && (
                <p className="mt-0.5 text-xs text-ink-400">
                  {format(new Date(step.targetDate), "d MMM yyyy")}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Marker({ status }: { status: JourneyStatus }) {
  if (status === "completed") {
    return (
      <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white shadow-brand">
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center">
        {/* pulsing halo */}
        <span className="absolute inset-0 animate-ping rounded-full bg-amber-300/50" />
        <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-600 ring-4 ring-amber-50">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
        </span>
      </span>
    );
  }
  return (
    <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink-200 bg-white text-ink-300">
      <span className="h-2 w-2 rounded-full bg-current" />
    </span>
  );
}
