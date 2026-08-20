import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requirePlannerAccess } from "@/lib/planner/guard";
import { getMeeting, getSafeProjectionViews } from "@/lib/planner/meetings/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { SyncStatusBadge, MeetStatusBadge } from "@/components/planner/sync-status-badge";
import { MeetingJoinButton } from "@/components/planner/meeting-join-button";
import { RetrySyncButton } from "@/components/planner/retry-sync-button";
import { MeetingForm } from "@/components/planner/meeting-form";
import { MeetingOutcomeNotes } from "@/components/planner/meeting-outcome-notes";
import { MeetingFollowUpComposer } from "@/components/planner/meeting-followup-composer";
import { Badge } from "@/components/ui/badge";
import { deriveMeetingState, LIFECYCLE_META } from "@/lib/planner/meetings/lifecycle";

export const metadata: Metadata = { title: "Meeting" };

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePlannerAccess();

  const { id } = await params;
  const data = await getMeeting(id);
  if (!data) notFound();

  const views = await getSafeProjectionViews([id]);
  const view = views.get(id);

  const m = data.meeting;
  const state = deriveMeetingState(m, new Date());
  const isCompleted = state === "completed";

  return (
    <div className="mx-auto max-w-2xl space-y-6 animate-fade-in">
      <Link
        href="/admin/planner/meetings"
        className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800"
      >
        <ChevronLeft className="h-4 w-4" /> Meetings
      </Link>
      <PageHeader
        title="Edit meeting"
        actions={<Badge tone={LIFECYCLE_META[state].tone}>{LIFECYCLE_META[state].label}</Badge>}
      />

      {/* Internal outcome notes — never emailed, never projected. */}
      <Card>
        <CardContent className="py-4">
          <MeetingOutcomeNotes id={m.id} initialNotes={m.outcome_notes} />
        </CardContent>
      </Card>

      {/* Optional follow-up — only once the meeting is Completed. Completely
          separate from marking attended; the admin opts in explicitly. */}
      {isCompleted && (
        <Card>
          <CardContent id="followup" className="space-y-4 py-4">
            <div>
              <h2 className="font-display text-lg font-bold text-ink-900">Send a follow-up</h2>
              <p className="text-sm text-ink-500">
                Optional. Choose who to email and edit the message before sending.
              </p>
            </div>
            <MeetingFollowUpComposer
              id={m.id}
              attendees={data.attendees.map((a) => ({ email: a.email, displayName: a.display_name }))}
              alreadySent={Boolean(m.thank_you_sent_at)}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <span className="text-sm text-ink-500">Calendar projection:</span>
          <SyncStatusBadge view={view} />
          <MeetStatusBadge view={view} />
          <MeetingJoinButton
            meetUrl={view?.meetUrl ?? null}
            startsAt={m.starts_at}
            endsAt={m.ends_at}
          />
          <RetrySyncButton meetingId={m.id} syncState={view?.syncState} />
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
