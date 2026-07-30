import type { Metadata } from "next";
import Link from "next/link";
import { Sun, CalendarRange, CalendarDays, ArrowRight } from "lucide-react";
import { requirePlannerAccess } from "@/lib/planner/guard";
import { listMeetings, getSafeProjectionViews } from "@/lib/planner/meetings/queries";
import {
  upcomingMeetings,
  meetingsOnDate,
  meetingsInRange,
  todayDate,
  weekRange,
} from "@/lib/planner/meetings/date-views";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MeetingList } from "@/components/planner/meeting-list";

export const metadata: Metadata = { title: "Planner" };

export default async function PlannerOverviewPage() {
  await requirePlannerAccess();

  const now = new Date();
  const meetings = await listMeetings();
  const views = await getSafeProjectionViews(meetings.map((m) => m.id));

  const today = meetingsOnDate(meetings, todayDate(now));
  const { start, end } = weekRange(now);
  const thisWeek = meetingsInRange(meetings, start, end);
  const upcoming = upcomingMeetings(meetings, now).slice(0, 5);

  const stats = [
    { label: "Today", value: today.length, href: "/admin/planner/today", icon: Sun },
    { label: "This week", value: thisWeek.length, href: "/admin/planner/week", icon: CalendarRange },
    { label: "All meetings", value: meetings.length, href: "/admin/planner/meetings", icon: CalendarDays },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Planner"
        description="Your internal operations at a glance — meetings, schedule and tasks."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <Link key={s.href} href={s.href}>
            <Card className="transition-colors hover:border-brand-200">
              <CardContent className="flex items-center justify-between py-5">
                <div>
                  <p className="text-2xl font-bold text-ink-900">{s.value}</p>
                  <p className="text-sm text-ink-500">{s.label}</p>
                </div>
                <s.icon className="h-6 w-6 text-brand-400" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Upcoming meetings</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/planner/meetings">
              View calendar <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <MeetingList
            meetings={upcoming}
            views={views}
            showActions={false}
            emptyLabel="Nothing scheduled. Create a meeting from the Calendar."
          />
        </CardContent>
      </Card>
    </div>
  );
}
