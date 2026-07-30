import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, Plus } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { PLANNER_ENABLED } from "@/lib/flags";
import { isGoogleConfigured } from "@/lib/google";
import { listMeetings, getSafeProjectionViews } from "@/lib/planner/meetings/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SyncStatusBadge, MeetStatusBadge } from "@/components/planner/sync-status-badge";
import { MeetLink } from "@/components/planner/meet-link";
import { MeetingRowActions } from "@/components/planner/meeting-row-actions";
import { ReconcileNowButton } from "@/components/planner/reconcile-now-button";

export const metadata: Metadata = { title: "Meetings" };

function formatRange(startsAt: string, endsAt: string, tz: string): string {
  const start = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(startsAt));
  const end = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(endsAt));
  return `${start} – ${end}`;
}

export default async function MeetingsPage() {
  await requireAdmin();
  if (!PLANNER_ENABLED) notFound();

  const meetings = await listMeetings();
  const views = await getSafeProjectionViews(meetings.map((m) => m.id));
  const googleReady = isGoogleConfigured();

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Meetings"
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
        <div className="space-y-3">
          {meetings.map((m) => {
            const view = views.get(m.id);
            return (
              <Card key={m.id}>
                <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/planner/meetings/${m.id}`}
                        className="truncate font-semibold text-ink-900 hover:text-brand-700"
                      >
                        {m.title}
                      </Link>
                      {m.status === "cancelled" && (
                        <Badge tone="neutral">Cancelled</Badge>
                      )}
                    </div>
                    <p className="text-sm text-ink-500">
                      {formatRange(m.starts_at, m.ends_at, m.time_zone)}{" "}
                      <span className="text-ink-400">· {m.time_zone}</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <SyncStatusBadge view={view} />
                      <MeetStatusBadge view={view} />
                      <MeetLink url={view?.meetUrl ?? null} />
                    </div>
                  </div>
                  <MeetingRowActions id={m.id} status={m.status} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
