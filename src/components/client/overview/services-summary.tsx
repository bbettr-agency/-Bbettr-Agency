import { getService } from "@/lib/services";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { OverviewServiceInput } from "@/lib/client-overview";
import type { OperationalStatus } from "@/lib/service-operational-state";

/**
 * A calm, single-card summary of the client's services (CX2) — used for multi-
 * service and services-only clients, so the Overview never becomes a wall of
 * service cards. Live work is given stronger hierarchy than work still in setup.
 * Presentation only; statuses arrive pre-resolved. Full per-service surfaces are
 * a later programme (CX3), not built here.
 */
function tone(op: OperationalStatus): { dot: string; text: string } {
  switch (op) {
    case "active":
      return { dot: "bg-emerald-500", text: "text-emerald-700" };
    case "in_progress":
    case "setup":
      return { dot: "bg-amber-500", text: "text-amber-700" };
    default:
      return { dot: "bg-ink-300", text: "text-ink-400" };
  }
}

const RANK: Record<OperationalStatus, number> = {
  active: 0,
  in_progress: 1,
  setup: 2,
  paused: 3,
  not_started: 4,
};

export function ServicesSummary({ services }: { services: OverviewServiceInput[] }) {
  if (services.length === 0) return null;
  const ordered = [...services].sort((a, b) => RANK[a.operational] - RANK[b.operational]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your services</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-ink-100 p-0">
        {ordered.map((svc) => {
          const Icon = getService(svc.service).icon;
          const t = tone(svc.operational);
          return (
            <div
              key={svc.service}
              className="flex items-center gap-3 px-6 py-3.5"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <Icon className="h-4.5 w-4.5" />
              </span>
              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">
                {svc.name}
              </p>
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1.5 text-xs font-medium",
                  t.text
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", t.dot)} />
                {svc.statusLabel}
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
