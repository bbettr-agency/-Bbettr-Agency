import { Card, CardContent } from "@/components/ui/card";
import { formatCountdown } from "@/lib/planner/meetings/date-views";
import type { TodayProgress as TodayProgressData } from "@/lib/planner/today/today-progress";

/** Today's Progress — honest counts; partial estimates never manufacture precision. */
function estimateLabel(p: TodayProgressData): string {
  const hasEst = p.estimatedRemainingMinutes > 0;
  const parts: string[] = [];
  if (hasEst) parts.push(`~${formatCountdown(p.estimatedRemainingMinutes)}`);
  if (p.remainingWithoutEstimate > 0) parts.push(`${p.remainingWithoutEstimate} without an estimate`);
  return parts.length ? parts.join(" + ") : "—";
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-lg font-semibold text-ink-900">{value}</div>
      <div className="text-xs text-ink-500">{label}</div>
    </div>
  );
}

export function TodayProgress({ progress }: { progress: TodayProgressData }) {
  return (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-ink-700">Today&rsquo;s progress</span>
          <span className="text-sm font-semibold text-ink-900">{progress.completionPct}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={progress.completionPct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progress.completionPct}%` }} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat label="Completed" value={progress.completed} />
          <Stat label="Remaining" value={progress.remaining} />
          <Stat label="Overdue" value={progress.overdue} />
          <Stat label="Meetings left" value={progress.meetingsRemaining} />
          <Stat label="Est. work left" value={estimateLabel(progress)} />
        </div>
      </CardContent>
    </Card>
  );
}
