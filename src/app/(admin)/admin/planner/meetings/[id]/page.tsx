import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { PLANNER_ENABLED } from "@/lib/flags";
import { getMeeting, getSafeProjectionViews } from "@/lib/planner/meetings/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { SyncStatusBadge, MeetStatusBadge } from "@/components/planner/sync-status-badge";
import { MeetLink } from "@/components/planner/meet-link";
import { MeetingForm } from "@/components/planner/meeting-form";

export const metadata: Metadata = { title: "Meeting" };

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  if (!PLANNER_ENABLED) notFound();

  const { id } = await params;
  const data = await getMeeting(id);
  if (!data) notFound();

  const views = await getSafeProjectionViews([id]);
  const view = views.get(id);

  return (
    <div className="mx-auto max-w-2xl space-y-6 animate-fade-in">
      <Link
        href="/admin/planner/meetings"
        className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800"
      >
        <ChevronLeft className="h-4 w-4" /> Meetings
      </Link>
      <PageHeader title="Edit meeting" />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <span className="text-sm text-ink-500">Calendar projection:</span>
          <SyncStatusBadge view={view} />
          <MeetStatusBadge view={view} />
          <MeetLink url={view?.meetUrl ?? null} />
          {view?.lastSyncAt && (
            <span className="text-xs text-ink-400">
              Last synced{" "}
              {new Intl.DateTimeFormat("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(view.lastSyncAt))}
            </span>
          )}
        </CardContent>
      </Card>

      <MeetingForm
        initial={{
          id: data.meeting.id,
          title: data.meeting.title,
          description: data.meeting.description,
          startsAt: data.meeting.starts_at,
          endsAt: data.meeting.ends_at,
          timeZone: data.meeting.time_zone,
          hasMeet: data.meeting.has_meet,
          attendees: data.attendees.map((a) => ({
            email: a.email,
            displayName: a.display_name,
          })),
        }}
      />
    </div>
  );
}
