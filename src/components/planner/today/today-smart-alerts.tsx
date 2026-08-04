import { AlertTriangle, Clock, Info } from "lucide-react";
import type { TodayAlert } from "@/lib/planner/today/smart-alerts";

/** Smart alerts — only genuine, actionable items. Renders nothing when the list is empty. */
const ICON = { danger: AlertTriangle, warning: Clock, info: Info } as const;
const ACCENT = {
  danger: "border-red-200 bg-red-50 text-red-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
} as const;

export function TodaySmartAlerts({ alerts }: { alerts: TodayAlert[] }) {
  if (alerts.length === 0) return null;
  return (
    <section aria-label="Alerts" className="space-y-2">
      {alerts.map((a) => {
        const Icon = ICON[a.tone];
        return (
          <div key={a.key} className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${ACCENT[a.tone]}`}>
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span>{a.message}</span>
          </div>
        );
      })}
    </section>
  );
}
