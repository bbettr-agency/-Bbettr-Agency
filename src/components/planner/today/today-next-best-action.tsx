import { Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCountdown, formatDayLabel } from "@/lib/planner/meetings/date-views";
import type { NextBestAction } from "@/lib/planner/today/next-best-action";
import type { TaskView } from "@/lib/planner/tasks/task-view";
import type { TaskCommandTarget } from "@/components/planner/tasks/task-command-target";
import { TaskPriorityBadge } from "@/components/planner/tasks/task-priority-badge";
import { TaskCommandControls } from "@/components/planner/tasks/task-command-controls";
import { MeetLink } from "@/components/planner/meet-link";
import { MeetingCountdown } from "./meeting-countdown";

const targetOf = (t: TaskView): TaskCommandTarget => ({ taskId: t.id, aggregateVersion: t.aggregateVersion, status: t.status, title: t.title });

/** The dominant card: exactly one recommended task (with lifecycle controls) or meeting-prep. */
export function TodayNextBestAction({ nba, now, meetUrl }: { nba: NextBestAction; now: Date; meetUrl?: string | null }) {
  if (!nba) return null;
  return (
    <Card className="border-brand-100 shadow-card-hover">
      <CardContent className="py-5">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-600">
          <Sparkles className="h-3.5 w-3.5" aria-hidden /> Next best action
        </div>

        {nba.kind === "task" ? (
          <div className="mt-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-ink-900">{nba.task.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                <TaskPriorityBadge priority={nba.task.priority} />
                {nba.task.dueDate ? (
                  <span className={nba.task.isOverdue ? "font-medium text-red-600" : ""}>Due {formatDayLabel(nba.task.dueDate, now)}</span>
                ) : null}
                {nba.task.scheduledDate ? <span>Scheduled {formatDayLabel(nba.task.scheduledDate, now)}</span> : null}
                {nba.task.estimatedMinutes != null ? <span>~{formatCountdown(nba.task.estimatedMinutes)}</span> : null}
                {nba.minutesToNextMeeting != null && nba.minutesToNextMeeting > 0 ? <span>· {formatCountdown(nba.minutesToNextMeeting)} to next meeting</span> : null}
              </div>
              <p className="mt-1 text-sm text-ink-600">{nba.why}</p>
            </div>
            <TaskCommandControls target={targetOf(nba.task)} />
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-base font-semibold text-ink-900">{nba.meeting.title}</p>
              <p className="mt-1 text-sm text-ink-600">
                Starts <MeetingCountdown startsAt={nba.meeting.startsAt} initialMinutes={nba.minutesUntil} /> · {nba.why}
              </p>
            </div>
            {nba.meeting.hasMeet ? <MeetLink url={meetUrl ?? null} /> : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
