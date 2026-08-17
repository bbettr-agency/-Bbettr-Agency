import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Plus } from "lucide-react";
import { requirePlannerAccess } from "@/lib/planner/guard";
import { isGoogleConfigured } from "@/lib/google";
import { listMeetings, getSafeProjectionViews } from "@/lib/planner/meetings/queries";
import { toCalendarMeeting } from "@/lib/planner/meetings/view-types";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MeetingCalendar } from "@/components/planner/meeting-calendar";
import { ReconcileNowButton } from "@/components/planner/reconcile-now-button";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage() {
  await requirePlannerAccess();

  const meetings = await listMeetings();
  const views = await getSafeProjectionViews(meetings.map((m) => m.id));
  const googleReady = isGoogleConfigured();

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Calendar"
        description="Internal meetings, projected to the shared agency Google Calendar. The Portal is the source of truth — Google is a one-way projection."
        actions={
          <Button asChild>
            <Link href="/admin/planner/meetings/new">
              <Plus className="h-4 w-4" /> New meeting
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ReconcileNowButton />
        {!googleReady && (
          <span className="text-xs text-amber-700">
            Google isn&rsquo;t connected — meetings still work; calendar projection is paused.
          </span>
        )}
      </div>

      {meetings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <CalendarClock className="h-8 w-8 text-ink-300" />
            <p className="text-sm text-ink-500">No meetings yet.</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/planner/meetings/new">Create your first meeting</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <MeetingCalendar
          meetings={meetings.map(toCalendarMeeting)}
          viewsObj={Object.fromEntries(views)}
          nowIso={new Date().toISOString()}
        />
      )}
    </div>
  );
}
