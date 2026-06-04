import { CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getService } from "@/lib/services";
import type { Readiness } from "@/lib/readiness";

/**
 * Presentational asset-readiness checklist, shared by the client dashboard and
 * the admin client workspace. Renders each purchased service with its required
 * items marked Received / Pending.
 */
export function ReadinessChecklist({
  readiness,
  className,
}: {
  readiness: Readiness;
  className?: string;
}) {
  if (!readiness.hasItems) return null;

  return (
    <div className={cn("space-y-4", className)}>
      {readiness.services.map((svc) => {
        const Icon = getService(svc.service).icon;
        return (
          <div
            key={svc.service}
            className="rounded-xl border border-ink-100 p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-ink-400" />
                <span className="text-sm font-semibold text-ink-900">
                  {svc.name}
                </span>
              </div>
              <span
                className={cn(
                  "text-xs font-medium",
                  svc.complete ? "text-emerald-600" : "text-ink-400"
                )}
              >
                {svc.done}/{svc.total} received
              </span>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {svc.items.map((item) => (
                <li
                  key={item.label}
                  className="flex items-center gap-2 text-sm"
                >
                  {item.done ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-ink-300" />
                  )}
                  <span className={item.done ? "text-ink-700" : "text-ink-500"}>
                    {item.label}
                  </span>
                  <span
                    className={cn(
                      "ml-auto text-xs font-medium",
                      item.done ? "text-emerald-600" : "text-amber-600"
                    )}
                  >
                    {item.done ? "Received" : "Pending"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
