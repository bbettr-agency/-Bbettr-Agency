import type { Metadata } from "next";
import Link from "next/link";
import {
  Plus,
  CalendarDays,
  CalendarRange,
  Clock,
  RefreshCw,
  CalendarCheck,
  ArrowRight,
} from "lucide-react";
import { requirePlannerAccess } from "@/lib/planner/guard";
import { listMeetings, getSafeProjectionViews } from "@/lib/planner/meetings/queries";
import { listAdminTeam } from "@/lib/planner/team";
import { getGoogleConnectionStatus } from "@/lib/google";
import {
  AGENCY_TZ,
  localDate,
  todayDate,
  weekRange,
  formatDayLabel,
  formatTimeInZone,
} from "@/lib/planner/meetings/date-views";
import {
  scheduledMeetings,
  meetingsTodayCount,
  meetingsThisWeekCount,
  nextMeeting,
  syncHealth,
  timelineDays,
  overlapCountOnDay,
  busiestDay,
  busiestOwner,
} from "@/lib/planner/meetings/meeting-metrics";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MeetingTimeline } from "@/components/planner/overview/meeting-timeline";
import { TeamMeetingLoad } from "@/components/planner/overview/team-meeting-load";
import { BriefingList, type BriefingItem } from "@/components/planner/overview/briefing-list";

export const metadata: Metadata = { title: "Planner Overview" };

const plural = (n: number) => (n === 1 ? "" : "s");

export default async function PlannerOverviewPage() {
  await requirePlannerAccess();

  const tz = AGENCY_TZ;
  const now = new Date();
  const nowMs = now.getTime();

  const [meetings, team, google] = await Promise.all([
    listMeetings(),
    listAdminTeam(),
    getGoogleConnectionStatus(),
  ]);
  const views = await getSafeProjectionViews(meetings.map((m) => m.id));

  const ownerNames = new Map(team.map((t) => [t.id, t.fullName]));
  const ownerName = (id: string) => ownerNames.get(id) ?? "Unknown";

  // ── Core metrics (cancelled excluded from totals; past never "next") ────────
  const todayStr = todayDate(now, tz);
  const { start: weekStart, end: weekEnd } = weekRange(now, tz);
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const tomorrowStr = new Date(Date.UTC(ty, tm - 1, td + 1)).toISOString().slice(0, 10);

  const todayCount = meetingsTodayCount(meetings, now, tz);
  const weekCount = meetingsThisWeekCount(meetings, now, tz);
  const next = nextMeeting(meetings, now);
  const health = syncHealth(views);
  const days = timelineDays(meetings, now, tz);

  const scheduled = scheduledMeetings(meetings);
  const teamLoad = team
    .map((member) => {
      const mine = scheduled.filter((m) => m.created_by === member.id);
      const mineNext = nextMeeting(mine, now);
      return {
        id: member.id,
        name: member.fullName,
        today: mine.filter((m) => localDate(m.starts_at, tz) === todayStr).length,
        week: mine.filter((m) => {
          const d = localDate(m.starts_at, tz);
          return d >= weekStart && d <= weekEnd;
        }).length,
        nextTime: mineNext ? formatTimeInZone(mineNext.starts_at, tz) : null,
      };
    })
    .sort((a, b) => b.week - a.week || b.today - a.today);

  // ── KPI: Calendar Sync Health (prominent only when failures exist) ──────────
  let syncValue: string;
  let syncHint: string;
  let syncClass: string | undefined;
  if (!google.connected) {
    syncValue = "Not connected";
    syncHint = "Connect in Integrations";
  } else if (health.failed > 0) {
    syncValue = `${health.failed} failed`;
    syncHint = health.pending > 0 ? `${health.pending} pending` : "Needs attention";
    syncClass = "border-red-200 bg-red-50";
  } else if (health.pending > 0) {
    syncValue = `${health.pending} pending`;
    syncHint = "Meet links provisioning";
  } else {
    syncValue = "Healthy";
    syncHint = `${health.synced} synced`;
  }

  const nextDayLabel = next ? formatDayLabel(localDate(next.starts_at, tz), now, tz) : "";

  // ── Today's briefing (what's happening / who / sync) ────────────────────────
  const briefing: BriefingItem[] = [];
  briefing.push(
    todayCount > 0
      ? { text: `${todayCount} meeting${plural(todayCount)} scheduled today.`, href: "/admin/planner/today" }
      : { text: "No meetings scheduled today." }
  );
  if (next) {
    const sameDay = localDate(next.starts_at, tz) === todayStr;
    const when = sameDay
      ? `at ${formatTimeInZone(next.starts_at, tz)}`
      : `${nextDayLabel} at ${formatTimeInZone(next.starts_at, tz)}`;
    briefing.push({ text: `Next meeting ${when} — ${next.title}.`, href: `/admin/planner/meetings/${next.id}` });
  }
  const topOwner = busiestOwner(meetings, now, tz);
  if (topOwner && topOwner.count >= 2) {
    briefing.push({ text: `${ownerName(topOwner.ownerId)} has the most meetings this week (${topOwner.count}).` });
  }
  if (!google.connected) {
    briefing.push({ text: "Google Calendar is not connected.", href: "/admin/integrations", tone: "warning" });
  } else if (health.failed > 0) {
    briefing.push({ text: `${health.failed} meeting${plural(health.failed)} failed to sync.`, href: "/admin/integrations", tone: "warning" });
  } else if (health.pending > 0) {
    briefing.push({ text: `${health.pending} Meet link${plural(health.pending)} still provisioning.` });
  } else {
    briefing.push({ text: "Google Calendar sync is healthy.", tone: "success" });
  }
  const briefingItems = briefing.slice(0, 5);

  // ── Planner insights (scheduling structure) ─────────────────────────────────
  const insights: BriefingItem[] = [];
  const overToday = overlapCountOnDay(meetings, todayStr, tz);
  insights.push(
    overToday > 0
      ? { text: `${overToday} meeting${plural(overToday)} overlap today.`, tone: "warning" }
      : { text: "No overlapping meetings today.", tone: "success" }
  );
  for (const day of days) {
    if (day.date === todayStr) continue;
    const n = overlapCountOnDay(meetings, day.date, tz);
    if (n > 0) {
      insights.push({ text: `${n} meeting${plural(n)} overlap on ${formatDayLabel(day.date, now, tz)}.`, tone: "warning" });
      break;
    }
  }
  const bDay = busiestDay(meetings, now, tz);
  if (bDay && bDay.count >= 2) {
    insights.push({ text: `${formatDayLabel(bDay.date, now, tz)} is the busiest meeting day (${bDay.count}).` });
  }
  if (todayCount > 0) {
    const remaining = scheduled.filter(
      (m) => localDate(m.starts_at, tz) === todayStr && new Date(m.starts_at).getTime() >= nowMs
    ).length;
    if (remaining === 0) insights.push({ text: "No meetings remain for today.", tone: "success" });
  }
  const insightItems = insights.slice(0, 4);

  const weekConflicts = days.reduce((acc, d) => acc + overlapCountOnDay(meetings, d.date, tz), 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Planner Overview"
        description="A real-time view of your team's meetings and calendar health."
        actions={
          <div className="flex items-center gap-2">
            <Button asChild size="sm">
              <Link href="/admin/planner/meetings/new">
                <Plus className="h-4 w-4" /> Schedule meeting
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/planner/meetings">
                <CalendarDays className="h-4 w-4" /> View calendar
              </Link>
            </Button>
          </div>
        }
      />

      {/* Live status strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-500">
        <span>Last updated {formatTimeInZone(now.toISOString(), tz)}</span>
        <span className="text-ink-300">·</span>
        <span className="inline-flex items-center gap-1.5">
          Google Calendar
          {google.connected ? (
            <Badge tone="success" dot>Connected</Badge>
          ) : google.status === "reconnect_required" ? (
            <Badge tone="warning" dot>Reconnect required</Badge>
          ) : (
            <Badge tone="neutral" dot>Not connected</Badge>
          )}
        </span>
        <span className="text-ink-300">·</span>
        <span>
          {team.length} team member{plural(team.length)}
          <span className="ml-1 text-ink-400">(one shared agency calendar)</span>
        </span>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Meetings today" value={todayCount} icon={CalendarCheck} />
        <StatCard label="Meetings this week" value={weekCount} icon={CalendarRange} />
        <StatCard
          label="Next meeting"
          value={next ? formatTimeInZone(next.starts_at, tz) : "—"}
          hint={next ? `${nextDayLabel} · ${next.title}` : "Nothing upcoming"}
          icon={Clock}
        />
        <StatCard label="Calendar sync" value={syncValue} hint={syncHint} icon={RefreshCw} className={syncClass} />
      </div>

      {/* Today's briefing */}
      <Card>
        <CardHeader>
          <CardTitle>Today&rsquo;s briefing</CardTitle>
        </CardHeader>
        <CardContent>
          <BriefingList items={briefingItems} />
        </CardContent>
      </Card>

      {/* Meeting timeline (central section) */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>Meeting timeline</CardTitle>
          <span className="text-xs text-ink-500">
            {todayCount} today · {weekCount} this week
            {next ? ` · next ${formatTimeInZone(next.starts_at, tz)}` : ""}
          </span>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-ink-400">
            {weekConflicts === 0
              ? "No scheduling conflicts this week."
              : `${weekConflicts} scheduling conflict${plural(weekConflicts)} this week.`}
            {bDay && bDay.count >= 2 ? ` Busiest day: ${formatDayLabel(bDay.date, now, tz)}.` : ""}
          </p>
          <MeetingTimeline days={days} views={views} ownerName={ownerName} nextId={next?.id ?? null} nowMs={nowMs} tz={tz} />
          <div className="pt-1">
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/planner/meetings">
                View full calendar <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Team meeting load (meeting volume only — not capacity) */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-ink-900">Team meeting load</h2>
          <span className="text-xs text-ink-400">Meeting volume · not capacity</span>
        </div>
        <TeamMeetingLoad members={teamLoad} />
      </div>

      {/* Planner insights */}
      <Card>
        <CardHeader>
          <CardTitle>Planner insights</CardTitle>
        </CardHeader>
        <CardContent>
          <BriefingList items={insightItems} />
        </CardContent>
      </Card>
    </div>
  );
}
