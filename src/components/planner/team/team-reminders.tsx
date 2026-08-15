import { Repeat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatShortDate, INTERNAL_CLIENT_LABEL, type TeamReminderGroup, type TeamTaskFacet } from "@/lib/planner/team/team-board";

/**
 * Team Reminders — recurring reminder occurrences grouped by responsible admin.
 * READ-ONLY (Team View has no task controls): it gives management visibility of
 * recurring commitments without letting them inflate Team Workload. Retains client
 * name, cadence, scheduled/due date and the overdue indicator.
 */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function ReminderRow({ r }: { r: TeamTaskFacet }) {
  const date = r.dueDate ?? r.scheduledDate;
  return (
    <li className="flex items-start gap-2 py-2">
      <Repeat className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm text-ink-800 break-words">{r.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-500">
          <span>{r.recurrenceLabel ?? "Reminder"}</span>
          {date ? (
            <>
              <span className="text-ink-300">·</span>
              <span className={r.isOverdue ? "font-medium text-red-600" : undefined}>
                {r.isOverdue ? "Overdue" : "Due"} {formatShortDate(date)}
              </span>
            </>
          ) : null}
          <span className="text-ink-300">·</span>
          <span className="break-words">{r.clientName ?? INTERNAL_CLIENT_LABEL}</span>
        </p>
      </div>
    </li>
  );
}

export function TeamReminders({ groups }: { groups: TeamReminderGroup[] }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink-700">Team reminders</h2>
        <span className="text-xs text-ink-400">Grouped by admin</span>
      </div>
      {groups.length === 0 ? (
        <p className="text-sm text-ink-500">No recurring reminders.</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <Card key={g.memberId}>
              <CardHeader className="flex-row items-center justify-between gap-3">
                <CardTitle className="text-sm">{firstName(g.memberName)}&rsquo;s Reminders</CardTitle>
                <span className="text-xs text-ink-500">{g.reminders.length}</span>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-ink-100">
                  {g.reminders.map((r) => (
                    <ReminderRow key={r.id} r={r} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
