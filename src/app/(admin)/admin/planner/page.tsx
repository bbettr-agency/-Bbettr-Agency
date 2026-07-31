import type { Metadata } from "next";
import Link from "next/link";
import {
  Plus,
  CalendarDays,
  CalendarRange,
  Clock,
  RefreshCw,
  CalendarCheck,
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
  bucketTodayMeetings,
  upcomingWeekDays,
  capDays,
  startsWithinMinutes,
  overlapCountOnDay,
  busiestDay,
  busiestOwner,
} from "@/lib/planner/meetings/meeting-metrics";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/planner/overview/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TodayMeetings } from "@/components/planner/overview/today-meetings";
import { UpcomingMeetings } from "@/components/planner/overview/upcoming-meetings";
import { TeamMeetingLoad } from "@/components/planner/overview/team-meeting-load";
import { BriefingList, type BriefingItem } from "@/components/planner/overview/briefing-list";

export const metadata: Metadata = { title: "Planner Overview" };

const plural = (n: number) => (n === 1 ? "" : "s");

export default async function PlannerOverviewPage() {
  await requirePlannerAccess();

  const tz = AGENCY_TZ;
  const now = new Date();

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

  const todayCount = meetingsTodayCount(meetings, now, tz);
  const weekCount = meetingsThisWeekCount(meetings, now, tz);
  const next = nextMeeting(meetings, now);
  const health = syncHealth(views);

  const today = bucketTodayMeetings(meetings, now, tz);
  const completedToday = today.completed.length;
  const upcomingDays = capDays(upcomingWeekDays(meetings, now, tz), 5);

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
    .sort((a, b) => b.today - a.today || b.week - a.week);

  const nextDayLabel = next ? formatDayLabel(localDate(next.starts_at, tz), now, tz) : "";
  const nextSameDay = next ? localDate(next.starts_at, tz) === todayStr : false;

  // ── KPI: Calendar Sync (self-describing value; danger reads at a glance) ─────
  let syncValue: string;
  let syncTone: "default" | "success" | "warning" | "danger";
  if (!google.connected) {
    syncValue = "Not connected";
    syncTone = "warning";
  } else if (health.failed > 0) {
    syncValue = `${health.failed} Failed`;
    syncTone = "danger";
  } else if (health.pending > 0) {
    syncValue = `${health.pending} Pending`;
    syncTone = "warning";
  } else {
    syncValue = "Healthy";
    syncTone = "success";
  }

  // ── Today's briefing — prioritized, max 4, never filler ─────────────────────
  // Priority: failed syncs → conflicts → starting within the hour → busy team →
  // one informational line.
  const briefing: BriefingItem[] = [];
  if (!google.connected) {
    briefing.push({ text: "Google Calendar is not connected.", href: "/admin/integrations", tone: "warning" });
  } else if (health.failed > 0) {
    briefing.push({
      text: `${health.failed} meeting${plural(health.failed)} failed to sync to Google Calendar.`,
      href: "/admin/integrations",
      tone: "warning",
    });
  }

  const overlapToday = overlapCountOnDay(meetings, todayStr, tz);
  if (overlapToday > 0) {
    briefing.push({ text: `${overlapToday} meeting${plural(overlapToday)} overlap today — check for a clash.`, tone: "warning" });
  }

  const startingSoon = today.upcoming.filter((m) => startsWithinMinutes(m, now, 60));
  if (startingSoon.length > 0) {
    const soonest = startingSoon[0];
    briefing.push({
      text:
        startingSoon.length === 1
          ? `${soonest.title} starts at ${formatTimeInZone(soonest.starts_at, tz)}.`
          : `${startingSoon.length} meetings start within the hour — next is ${soonest.title} at ${formatTimeInZone(soonest.starts_at, tz)}.`,
      href: `/admin/planner/meetings/${soonest.id}`,
    });
  }

  const topOwner = busiestOwner(meetings, now, tz);
  if (topOwner && topOwner.count >= 3) {
    briefing.push({ text: `${ownerName(topOwner.ownerId)} has the most meetings this week (${topOwner.count}).` });
  }

  // One informational line if there is still room and nothing urgent filled it.
  if (briefing.length < 4) {
    if (todayCount === 0) {
      briefing.push({ text: "No meetings scheduled today — the calendar is clear.", tone: "success" });
    } else if (next && !startingSoon.length) {
      const when = nextSameDay
        ? `at ${formatTimeInZone(next.starts_at, tz)}`
        : `${nextDayLabel} at ${formatTimeInZone(next.starts_at, tz)}`;
      briefing.push({ text: `Next up: ${next.title} ${when}.`, href: `/admin/planner/meetings/${next.id}` });
    } else if (health.failed === 0 && health.pending === 0 && google.connected && briefing.length === 0) {
      briefing.push({ text: "Everything is on track — no conflicts and calendar sync is healthy.", tone: "success" });
    }
  }
  const briefingItems = briefing.slice(0, 4);

  // ── Planner insights — scheduling structure, max 4, genuinely useful ────────
  const insights: BriefingItem[] = [];
  insights.push(
    overlapToday > 0
      ? { text: `${overlapToday} meeting${plural(overlapToday)} overlap today.`, tone: "warning" }
      : { text: "No overlapping meetings today.", tone: "success" }
  );
  for (const day of upcomingDays) {
    const n = overlapCountOnDay(meetings, day.date, tz);
    if (n > 0) {
      insights.push({ text: `${n} meeting${plural(n)} overlap on ${formatDayLabel(day.date, now, tz)}.`, tone: "warning" });
      break;
    }
  }
  const bDay = busiestDay(meetings, now, tz);
  if (bDay && bDay.count >= 2) {
    insights.push({ text: `${formatDayLabel(bDay.date, now, tz)} is the busiest meeting day (${bDay.count} meetings).` });
  }
  if (todayCount > 0 && today.upcoming.length === 0 && today.current.length === 0) {
    insights.push({ text: "No meetings remain for today.", tone: "success" });
  }
  const insightItems = insights.slice(0, 4);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* 1 — Header */}
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

      {/* 2 — Planner health KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Meetings today"
          value={todayCount}
          secondary={
            todayCount === 0
              ? "Nothing scheduled"
              : `${completedToday} completed · ${todayCount - completedToday} to go`
          }
          icon={CalendarCheck}
        />
        <KpiCard
          label="Meetings this week"
          value={weekCount}
          secondary={weekCount === 0 ? "Clear week" : "Scheduled Mon–Sun"}
          icon={CalendarRange}
        />
        <KpiCard
          label="Next meeting"
          value={next ? formatTimeInZone(next.starts_at, tz) : "—"}
          secondary={next ? (nextSameDay ? next.title : `${nextDayLabel} · ${next.title}`) : "Nothing upcoming"}
          icon={Clock}
        />
        <KpiCard label="Calendar sync" value={syncValue} icon={RefreshCw} tone={syncTone} />
      </div>

      {/* 3 — Today's briefing */}
      <Card>
        <CardHeader>
          <CardTitle>Today&rsquo;s briefing</CardTitle>
        </CardHeader>
        <CardContent>
          {briefingItems.length > 0 ? (
            <BriefingList items={briefingItems} />
          ) : (
            <p className="text-sm text-ink-500">Nothing needs your attention right now.</p>
          )}
        </CardContent>
      </Card>

      {/* 4 — Today's meetings (dominant section) */}
      <Card className="border-brand-100 shadow-card-hover">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>Today&rsquo;s meetings</CardTitle>
          <span className="text-xs text-ink-500">
            {todayCount} scheduled
            {completedToday > 0 ? ` · ${completedToday} completed` : ""}
          </span>
        </CardHeader>
        <CardContent>
          <TodayMeetings buckets={today} views={views} ownerName={ownerName} tz={tz} now={now} />
        </CardContent>
      </Card>

      {/* 5 — Upcoming this week (secondary) */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>Upcoming this week</CardTitle>
          <span className="text-xs text-ink-500">Next {Math.min(5, weekCount)} · rest of the week</span>
        </CardHeader>
        <CardContent>
          <UpcomingMeetings days={upcomingDays} views={views} ownerName={ownerName} tz={tz} now={now} />
        </CardContent>
      </Card>

      {/* 6 — Team meeting load (tertiary; meeting volume only — not capacity) */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-ink-700">Team meeting load</h2>
          <span className="text-xs text-ink-400">Meeting volume · not capacity</span>
        </div>
        <TeamMeetingLoad members={teamLoad} />
      </div>

      {/* 7 — Planner insights (lightest) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-ink-700">Planner insights</CardTitle>
        </CardHeader>
        <CardContent>
          <BriefingList items={insightItems} />
        </CardContent>
      </Card>
    </div>
  );
}
