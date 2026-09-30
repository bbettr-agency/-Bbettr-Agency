import "server-only";
import { sendTransactionalEmail, type SendResult } from "@/lib/email/resend";
import { renderEmail } from "@/lib/email/templates";

/**
 * Meeting emails (branded Resend). Separate from the Google Calendar invitation:
 * the Portal owns this confirmation, so its delivery status is app-controlled and
 * honestly reported (unlike the Google invite, whose delivery is Google/Gmail's).
 * Best-effort — sendTransactionalEmail returns { ok:false } (never throws) when
 * RESEND_API_KEY is absent, so a missing key can't break meeting creation.
 */

/** Agency-local (meeting-timezone) date/time formatting — server-side, deterministic. */
function fmtDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}
function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export async function sendMeetingConfirmationEmail(opts: {
  to: string;
  attendeeName?: string | null;
  title: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  timeZone: string; // IANA
  meetUrl?: string | null;
}): Promise<SendResult> {
  const dateLabel = fmtDate(opts.startsAt, opts.timeZone);
  const timeLabel = `${fmtTime(opts.startsAt, opts.timeZone)} – ${fmtTime(opts.endsAt, opts.timeZone)}`;
  const html = renderEmail({
    preheader: `Your meeting “${opts.title}” is confirmed.`,
    heading: "Your meeting is confirmed",
    paragraphs: [
      `Hi ${opts.attendeeName || "there"},`,
      "Your meeting with Bbettr Agency has been scheduled. Here are the details:",
      `Meeting: ${opts.title}`,
      `Date: ${dateLabel}`,
      `Time: ${timeLabel} (${opts.timeZone})`,
      ...(opts.meetUrl ? [`Google Meet: ${opts.meetUrl}`] : []),
    ],
    cta: opts.meetUrl ? { label: "Join Google Meet", url: opts.meetUrl } : undefined,
    footnote: "Need to make a change? Just reply to this email and we'll help.",
  });
  return sendTransactionalEmail({ to: opts.to, subject: `Meeting confirmed: ${opts.title}`, html });
}

/**
 * The consolidated meeting INVITATION (branded Resend + .ics). This is the single
 * external guest email for a meeting: it carries the human host, date/time/zone,
 * the Google Meet link, context, AND a standards-compliant calendar invitation
 * attachment (METHOD:REQUEST for create/update, METHOD:CANCEL for cancellation).
 * Google Calendar sends NO guest email (sendUpdates=none); this replaces both the
 * bouncing Google invite and the old HTML-only confirmation. Best-effort — never
 * throws; returns { ok, id? } so delivery is recorded honestly.
 */
export async function sendMeetingInvitationEmail(opts: {
  to: string;
  attendeeName?: string | null;
  hostName?: string | null;
  title: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  timeZone: string; // IANA
  meetUrl?: string | null;
  cancelled: boolean;
  /** Pre-built .ics body. */
  ics: string;
  /** ICS METHOD, mirrored into the attachment content type. */
  icsMethod: "REQUEST" | "CANCEL";
  /** Deterministic provider idempotency key. */
  idempotencyKey?: string;
}): Promise<SendResult> {
  const dateLabel = fmtDate(opts.startsAt, opts.timeZone);
  const timeLabel = `${fmtTime(opts.startsAt, opts.timeZone)} – ${fmtTime(opts.endsAt, opts.timeZone)}`;
  const host = opts.hostName?.trim() || "Bbettr Agency";

  const html = opts.cancelled
    ? renderEmail({
        preheader: `“${opts.title}” has been cancelled.`,
        heading: "Your meeting has been cancelled",
        paragraphs: [
          `Hi ${opts.attendeeName || "there"},`,
          `The meeting “${opts.title}” scheduled for ${dateLabel} at ${timeLabel} (${opts.timeZone}) has been cancelled.`,
          "Your calendar has been updated to reflect this. If you'd like to arrange another time, just reply to this email.",
        ],
        footnote: "This cancellation was sent by Bbettr Agency.",
      })
    : renderEmail({
        preheader: `${host} has invited you to “${opts.title}”.`,
        heading: "You're invited",
        paragraphs: [
          `Hi ${opts.attendeeName || "there"},`,
          `${host} at Bbettr Agency has invited you to a meeting. The calendar invitation is attached — accept it to add it to your calendar.`,
          `Meeting: ${opts.title}`,
          `Date: ${dateLabel}`,
          `Time: ${timeLabel} (${opts.timeZone})`,
          ...(opts.meetUrl ? [`Google Meet: ${opts.meetUrl}`] : []),
        ],
        cta: opts.meetUrl ? { label: "Join Google Meet", url: opts.meetUrl } : undefined,
        footnote: "Can't make it? Just reply to this email and we'll help.",
      });

  const subject = opts.cancelled
    ? `Cancelled: ${opts.title}`
    : `Meeting invitation: ${opts.title}`;

  return sendTransactionalEmail({
    to: opts.to,
    subject,
    html,
    idempotencyKey: opts.idempotencyKey,
    attachments: [
      {
        filename: "invite.ics",
        content: opts.ics,
        contentType: `text/calendar; method=${opts.icsMethod}; charset=UTF-8`,
      },
    ],
  });
}

/**
 * No-show follow-up (branded Resend). Sent after an admin marks a meeting a
 * no-show. Slice D form: carries the secure self-service CTA — a "Reschedule
 * Meeting" button pointing at /reschedule/<raw-token>. The raw token exists ONLY
 * in this URL (never persisted; only its hash is stored). Best-effort like all
 * meeting mail: sendTransactionalEmail never throws.
 */
export async function sendNoShowFollowUpEmail(opts: {
  to: string;
  attendeeName?: string | null;
  title: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  timeZone: string; // IANA
  /** Public /reschedule/<raw-token> URL — the client's authorization link. */
  rescheduleUrl: string;
}): Promise<SendResult> {
  const dateLabel = fmtDate(opts.startsAt, opts.timeZone);
  const timeLabel = `${fmtTime(opts.startsAt, opts.timeZone)} – ${fmtTime(opts.endsAt, opts.timeZone)}`;
  const html = renderEmail({
    preheader: `We missed you at “${opts.title}” — pick a new time.`,
    heading: "Let's find a new time",
    paragraphs: [
      `Hi ${opts.attendeeName || "there"},`,
      `We noticed you weren't able to make “${opts.title}” on ${dateLabel} at ${timeLabel} (${opts.timeZone}).`,
      "No problem at all — use the button below to choose another date and time that works for you.",
    ],
    cta: { label: "Reschedule Meeting", url: opts.rescheduleUrl },
    footnote: "This link is personal to you and expires in 14 days. Prefer to arrange it directly? Just reply to this email.",
  });
  return sendTransactionalEmail({ to: opts.to, subject: `Reschedule your meeting: ${opts.title}`, html });
}

/**
 * Optional post-meeting follow-up (0054). Admin-authored subject + body (already
 * personalised per recipient by the caller). Rendered through the shared branded
 * template, which HTML-ESCAPES every paragraph — so admin free text is safe. Best
 * effort like all meeting mail: sendTransactionalEmail never throws. Sending a
 * follow-up is fully decoupled from the meeting's Completed state.
 */
export async function sendMeetingFollowUpEmail(opts: {
  to: string;
  subject: string;
  body: string;
}): Promise<SendResult> {
  // Each non-empty line becomes an escaped paragraph; blank lines are dropped.
  const paragraphs = opts.body.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const html = renderEmail({
    preheader: opts.subject,
    heading: opts.subject,
    paragraphs,
    footnote: "You can reply directly to this email to reach us.",
  });
  return sendTransactionalEmail({ to: opts.to, subject: opts.subject, html });
}
