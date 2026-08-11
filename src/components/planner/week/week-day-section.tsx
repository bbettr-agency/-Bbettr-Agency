import { cn } from "@/lib/utils";
import { formatDayLabel } from "@/lib/planner/meetings/date-views";
import { TaskRow } from "@/components/planner/tasks/task-row";
import type { AssignChoices } from "@/components/planner/tasks/task-command-target";
import type { WeekDay } from "@/lib/planner/week/week-grouping";

/**
 * One day of the week plan: a labelled section (Today emphasised) with the day's
 * scheduled tasks as actionable Task Kit rows, or a quiet empty line. Rendered for
 * all seven days so empty days read as available capacity to plan into. Light
 * section treatment (not a card each) keeps seven days scannable and mobile-clean.
 */
export function WeekDaySection({ day, now, today, assign }: { day: WeekDay; now: Date; today: string; assign?: AssignChoices }) {
  const isToday = day.date === today;
  return (
    <section>
      <div className="flex items-baseline justify-between border-b border-ink-100 pb-1.5">
        <h3 className={cn("text-sm font-semibold", isToday ? "text-brand-600" : "text-ink-700")}>{formatDayLabel(day.date, now)}</h3>
        <span className="text-xs text-ink-400">{day.tasks.length > 0 ? day.tasks.length : "—"}</span>
      </div>
      {day.tasks.length > 0 ? (
        <ul className="divide-y divide-ink-100">
          {day.tasks.map((v) => (
            <TaskRow key={v.id} view={v} now={now} assign={assign} />
          ))}
        </ul>
      ) : (
        <p className="py-2 text-sm text-ink-400">Nothing planned.</p>
      )}
    </section>
  );
}
