import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { MeetingInvitationStatus } from "@/lib/database.types";
import { buildInvitationIcs } from "./ics";
import {
  attendeeFacingSignature,
  planInvitations,
  uidForMeeting,
  type LedgerRow,
} from "./invitation-plan";
import { sendMeetingInvitationEmail } from "@/lib/email/meeting-notifications";

/**
 * Server-only orchestration of Portal → Resend meeting invitation delivery.
 *
 * Reads authoritative meeting state (service-role, since it runs from server
 * actions and the reconcile path with no user session), plans the required
 * per-recipient invitations deterministically (invitation-plan), and delivers each
 * as a standards-compliant .ics via the authenticated Resend identity — recording
 * every attempt in the `meeting_invitations` ledger so "guest invited" is an
 * observable fact, never inferred from Google event creation.
 *
 * Idempotent: the ledger's UNIQUE (meeting, attendee, sequence, method) plus a
 * deterministic Resend idempotency key mean a double-click / retry / reconciler
 * rerun never double-delivers. Never throws — meeting creation is already
 * authoritative; this reports honest delivery status.
 */

const ORGANIZER_EMAIL = "portal@bbettragency.com";

/** Statuses at which we must NOT resend the same (attendee, sequence, method). */
function isTerminalSent(status: MeetingInvitationStatus): boolean {
  return status === "sent" || status === "delivered" || status === "complained" || status === "bounced";
}

type AdminClient = ReturnType<typeof createAdminClient>;

export interface InvitationDeps {
  admin?: AdminClient;
  now?: () => Date;
  send?: typeof sendMeetingInvitationEmail;
}

export interface InvitationRecipientResult {
  email: string;
  method: "request" | "cancel";
  sequence: number;
  outcome: "sent" | "failed" | "skipped";
  error?: string;
}

export interface InvitationSummary {
  ok: boolean;
  reason?: string;
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  recipients: InvitationRecipientResult[];
}

const NOTHING: InvitationSummary = { ok: true, attempted: 0, sent: 0, failed: 0, skipped: 0, recipients: [] };

function sanitize(msg: string | undefined): string {
  return (msg ?? "send failed").replace(/[\r\n]+/g, " ").slice(0, 200);
}

/**
 * Emit (or reconcile) all invitations for a meeting's current state. Safe to call
 * after every create / update / cancel / reschedule — it only sends what has
 * actually changed. Best-effort and never throws.
 */
export async function emitMeetingInvitations(
  meetingId: string,
  deps: InvitationDeps = {}
): Promise<InvitationSummary> {
  const admin = deps.admin ?? createAdminClient();
  const now = deps.now ?? (() => new Date());
  const send = deps.send ?? sendMeetingInvitationEmail;

  try {
    const { data: meeting } = await admin
      .from("meetings")
      .select("id, title, description, starts_at, ends_at, time_zone, has_meet, status, deleted_at, created_by")
      .eq("id", meetingId)
      .maybeSingle();
    if (!meeting) return { ...NOTHING, ok: false, reason: "meeting_not_found" };

    const [{ data: attendeeRows }, { data: projection }, { data: hostProfile }, { data: ledgerRows }] =
      await Promise.all([
        admin.from("meeting_attendees").select("email, display_name").eq("meeting_id", meetingId),
        admin
          .from("calendar_projections")
          .select("meet_url")
          .eq("entity_type", "meeting")
          .eq("entity_id", meetingId)
          .maybeSingle(),
        admin.from("profiles").select("full_name").eq("id", meeting.created_by).maybeSingle(),
        admin
          .from("meeting_invitations")
          .select("attendee_email, method, sequence, content_signature, status")
          .eq("meeting_id", meetingId),
      ]);

    const attendees = attendeeRows ?? [];
    const nameByEmail = new Map<string, string | null>();
    for (const a of attendees) nameByEmail.set(a.email.toLowerCase(), a.display_name);

    const meetUrl = projection?.meet_url ?? null;
    const hostName = hostProfile?.full_name ?? null;
    const location = meetUrl ?? (meeting.has_meet ? "Google Meet" : null);
    const lifecycle: "active" | "cancelled" =
      meeting.deleted_at || meeting.status === "cancelled" ? "cancelled" : "active";

    const contentSig = attendeeFacingSignature({
      summary: meeting.title,
      startsAtIso: meeting.starts_at,
      endsAtIso: meeting.ends_at,
      timeZone: meeting.time_zone,
      location,
      meetUrl,
      description: meeting.description,
      lifecycle,
    });

    const ledger: LedgerRow[] = (ledgerRows ?? []).map((r) => ({
      attendee_email: r.attendee_email,
      method: r.method,
      sequence: r.sequence,
      content_signature: r.content_signature,
      status: r.status,
    }));

    const plan = planInvitations({
      currentAttendees: attendees.map((a) => a.email),
      lifecycle,
      contentSig,
      ledger,
    });

    const uid = uidForMeeting(meetingId);
    const dtStamp = now().toISOString();
    const recipients: InvitationRecipientResult[] = [];
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const p of plan) {
      // ── Idempotent claim ──────────────────────────────────────────────────
      const { data: existing } = await admin
        .from("meeting_invitations")
        .select("id, status")
        .eq("meeting_id", meetingId)
        .eq("attendee_email", p.email)
        .eq("sequence", p.sequence)
        .eq("method", p.method)
        .maybeSingle();

      let rowId: string;
      if (existing) {
        if (isTerminalSent(existing.status)) {
          skipped++;
          recipients.push({ email: p.email, method: p.method, sequence: p.sequence, outcome: "skipped" });
          continue;
        }
        rowId = existing.id; // 'queued' or 'failed' → (re)send
      } else {
        const { data: inserted, error: insErr } = await admin
          .from("meeting_invitations")
          .insert({
            meeting_id: meetingId,
            attendee_email: p.email,
            method: p.method,
            sequence: p.sequence,
            ics_uid: uid,
            content_signature: p.contentSignature,
            status: "queued",
          })
          .select("id")
          .single();
        if (insErr || !inserted) {
          // Likely a concurrent claim won the UNIQUE — re-read and defer to it.
          const { data: raced } = await admin
            .from("meeting_invitations")
            .select("id, status")
            .eq("meeting_id", meetingId)
            .eq("attendee_email", p.email)
            .eq("sequence", p.sequence)
            .eq("method", p.method)
            .maybeSingle();
          if (!raced || isTerminalSent(raced.status)) {
            skipped++;
            recipients.push({ email: p.email, method: p.method, sequence: p.sequence, outcome: "skipped" });
            continue;
          }
          rowId = raced.id;
        } else {
          rowId = inserted.id;
        }
      }

      // ── Build + send ──────────────────────────────────────────────────────
      const ics = buildInvitationIcs({
        method: p.method,
        uid,
        sequence: p.sequence,
        dtStampIso: dtStamp,
        startsAtIso: meeting.starts_at,
        endsAtIso: meeting.ends_at,
        timeZone: meeting.time_zone,
        summary: meeting.title,
        description: meeting.description,
        location,
        meetUrl,
        organizerEmail: ORGANIZER_EMAIL,
        organizerName: hostName ? `Bbettr Agency (${hostName})` : "Bbettr Agency",
        attendee: { email: p.email, name: nameByEmail.get(p.email) ?? null },
      });

      const res = await send({
        to: p.email,
        attendeeName: nameByEmail.get(p.email) ?? null,
        hostName,
        title: meeting.title,
        startsAt: meeting.starts_at,
        endsAt: meeting.ends_at,
        timeZone: meeting.time_zone,
        meetUrl,
        cancelled: p.method === "cancel",
        ics,
        icsMethod: p.method === "cancel" ? "CANCEL" : "REQUEST",
        idempotencyKey: `inv:${meetingId}:${p.sequence}:${p.method}:${p.email}`,
      });

      if (res.ok) {
        await admin
          .from("meeting_invitations")
          .update({
            status: "sent",
            resend_message_id: res.id ?? null,
            sent_at: now().toISOString(),
            last_error: null,
          })
          .eq("id", rowId);
        sent++;
        recipients.push({ email: p.email, method: p.method, sequence: p.sequence, outcome: "sent" });
      } else {
        await admin
          .from("meeting_invitations")
          .update({ status: "failed", last_error: sanitize(res.error) })
          .eq("id", rowId);
        failed++;
        recipients.push({
          email: p.email,
          method: p.method,
          sequence: p.sequence,
          outcome: "failed",
          error: sanitize(res.error),
        });
      }
    }

    return { ok: failed === 0, attempted: plan.length, sent, failed, skipped, recipients };
  } catch {
    // Never throw into a caller whose meeting write already succeeded.
    return { ...NOTHING, ok: false, reason: "invitation_error" };
  }
}
