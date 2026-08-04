import { Moon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { TodayProgress as TodayProgressData } from "@/lib/planner/today/today-progress";

/** Evening mode (~after 17:00): emphasis shifts to what was done + what remains.
 *  Never auto-moves unfinished tasks — rollover is an explicit user action. */
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-lg font-semibold text-ink-900">{value}</div>
      <div className="text-xs text-ink-500">{label}</div>
    </div>
  );
}

export function TodayEveningSummary({ progress, meetingsCompleted, firstName }: { progress: TodayProgressData; meetingsCompleted: number; firstName: string | null }) {
  const line =
    progress.remaining === 0
      ? "Everything for today is wrapped up — nice work."
      : `${progress.remaining} ${progress.remaining === 1 ? "task is" : "tasks are"} still open. Roll them over whenever you're ready.`;
  return (
    <Card className="border-brand-100 shadow-card-hover">
      <CardContent className="py-5">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
          <Moon className="h-4 w-4 text-brand-500" aria-hidden /> Winding down{firstName ? `, ${firstName}` : ""}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Tasks completed" value={progress.completed} />
          <Stat label="Meetings done" value={meetingsCompleted} />
          <Stat label="Tasks remaining" value={progress.remaining} />
          <Stat label="Completion" value={`${progress.completionPct}%`} />
        </div>
        <p className="mt-3 text-sm text-ink-600">{line}</p>
      </CardContent>
    </Card>
  );
}
