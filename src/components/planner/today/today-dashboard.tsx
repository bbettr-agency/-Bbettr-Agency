import { AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentProfile } from "@/lib/auth";
import { getTodayWorkspace, getInboxTasks } from "@/lib/planner/tasks/read-adapters";
import { toTaskView } from "@/lib/planner/tasks/task-view";
import { getRecurrenceLabels } from "@/lib/planner/recurrence/recurrence-read";
import { listAdminTeam } from "@/lib/planner/team";
import { listMeetings, getSafeProjectionViews } from "@/lib/planner/meetings/queries";
import { meetingsOnDate } from "@/lib/planner/meetings/date-views";
import { getInternalFeed } from "@/lib/internal-notifications";
import { groupToday, actionableToday } from "@/lib/planner/today/today-grouping";
import { nextBestAction } from "@/lib/planner/today/next-best-action";
import { todayProgress } from "@/lib/planner/today/today-progress";
import { smartAlerts } from "@/lib/planner/today/smart-alerts";
import { buildGreeting } from "@/lib/planner/today/greeting";
import { minutesUntil, remainingMeetings, type TodayMeeting } from "@/lib/planner/today/today-meeting";
import { TodayGreeting } from "./today-greeting";
import { TodaySmartAlerts } from "./today-smart-alerts";
import { TodayNextBestAction } from "./today-next-best-action";
import { TodayProgress } from "./today-progress";
import { TodayMeetings } from "./today-meetings";
import { TodayTasks } from "./today-tasks";
import { TodayActionableInbox } from "./today-actionable-inbox";
import { TodayQuickActions } from "./today-quick-actions";
import { TodayEveningSummary } from "./today-evening-summary";

/**
 * Today — the admin's personal agency command centre (flag-on). Server Component:
 * the task read is authoritative; meetings, team names, internal feed and inbox
 * count are best-effort (a failure never blanks the page). All deterministic
 * calculations run in the pure Today layer; only the meeting-countdown island and
 * the per-row task command controls hydrate.
 */
export async function TodayDashboard() {
  const now = new Date();
  const profile = await getCurrentProfile();
  const adminId = profile?.id ?? "";

  const [wsRes, meetingsRes, teamRes, feedRes, inboxRes] = await Promise.allSettled([
    getTodayWorkspace(now),
    listMeetings(),
    listAdminTeam(),
    adminId ? getInternalFeed(adminId) : Promise.resolve({ items: [], unreadCount: 0 }),
    getInboxTasks(),
  ]);

  if (wsRes.status === "rejected") {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-ink-500">
          <AlertCircle className="h-4 w-4 text-ink-400" />
          <span>Couldn&rsquo;t load Today right now. Refresh to try again.</span>
        </CardContent>
      </Card>
    );
  }

  const ws = wsRes.value;
  const today = ws.today;

  const nameById = new Map<string, string>();
  if (teamRes.status === "fulfilled") for (const m of teamRes.value) nameById.set(m.id, m.fullName);
  // Assign choices for the per-row "Assign to" control (workspace admins + me).
  const assign =
    profile && teamRes.status === "fulfilled"
      ? { admins: teamRes.value.map((m) => ({ id: m.id, name: m.fullName })), currentAdminId: profile.id }
      : undefined;

  // Cadence labels for the subtle "REMINDER · Monthly" tag (one batched, RLS-scoped read).
  const recurrenceLabels = await getRecurrenceLabels([...ws.active, ...ws.completedToday].map((t) => t.recurrence_definition_id)).catch(() => new Map<string, string>());
  const activeViews = ws.active.map((t) => toTaskView(t, nameById, today, recurrenceLabels));
  const completedViews = ws.completedToday.map((t) => toTaskView(t, nameById, today, recurrenceLabels));
  const groups = groupToday(activeViews, completedViews);
  const actionable = actionableToday(activeViews);

  const allMeetings = meetingsRes.status === "fulfilled" ? meetingsRes.value : [];
  const todayMeetings = meetingsOnDate(allMeetings, today);
  const meetViews = todayMeetings.length ? await getSafeProjectionViews(todayMeetings.map((m) => m.id)).catch(() => new Map()) : new Map();
  const meetingLites: TodayMeeting[] = todayMeetings.map((m) => ({ id: m.id, title: m.title, startsAt: m.starts_at, endsAt: m.ends_at, status: m.status, hasMeet: m.has_meet }));
  const remaining = remainingMeetings(meetingLites, now);
  const meetingsCompleted = meetingLites.filter((m) => m.status !== "cancelled" && new Date(m.endsAt).getTime() <= now.getTime()).length;

  const progress = todayProgress(actionable, completedViews, remaining.length);
  const nba = nextBestAction(actionable, meetingLites, now);
  const nbaMeetUrl = nba?.kind === "meeting" ? meetViews.get(nba.meeting.id)?.meetUrl ?? null : null;
  const dueTodayCount = actionable.filter((t) => t.dueDate === today && !t.isOverdue).length;
  const alerts = smartAlerts({ now, meetings: meetingLites, overdueCount: progress.overdue, dueTodayCount, estimatedRemainingMinutes: progress.estimatedRemainingMinutes });
  const greeting = buildGreeting(now, profile?.full_name, { tasks: actionable.length, meetings: remaining.length, overdue: progress.overdue });

  const soon = remaining[0] && minutesUntil(remaining[0].startsAt, now) <= 60 ? { title: remaining[0].title, startsAt: remaining[0].startsAt, minutes: minutesUntil(remaining[0].startsAt, now) } : null;
  const feed = feedRes.status === "fulfilled" ? feedRes.value : { items: [], unreadCount: 0 };
  const inboxCount = inboxRes.status === "fulfilled" ? inboxRes.value.length : 0;

  // Single-column daily execution page: supporting blocks (greeting/alerts/next
  // action/progress) frame the day, then every operational section stacks
  // full-width in order — Meetings, then the Today task sections. No two-column
  // grid, no Timeline (its work is now the stacked sections themselves).
  return (
    <div className="space-y-6 animate-fade-in">
      <TodayGreeting greeting={greeting} />
      <TodaySmartAlerts alerts={alerts} />
      {greeting.evening ? (
        <TodayEveningSummary progress={progress} meetingsCompleted={meetingsCompleted} firstName={greeting.firstName} />
      ) : (
        <TodayNextBestAction nba={nba} now={now} meetUrl={nbaMeetUrl} />
      )}
      <TodayProgress progress={progress} />
      <TodayMeetings meetings={todayMeetings} views={meetViews} soon={soon} />
      <TodayTasks groups={groups} now={now} assign={assign} />
      <TodayActionableInbox items={feed.items} inboxCount={inboxCount} />
      <TodayQuickActions />
    </div>
  );
}
