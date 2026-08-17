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
 * No-show follow-up (branded Resend). Sent after an admin marks a meeting a
 * no-show. This is the Slice C form — a "we missed you, reply to reschedule"
 * note with NO self-service link (Slice D upgrades this same email to embed the
 * secure /reschedule/<token> link once tokens are issued). Best-effort like all
 * meeting mail: sendTransactionalEmail never throws.
 */
export async function sendNoShowFollowUpEmail(opts: {
  to: string;
  attendeeName?: string | null;
  title: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  timeZone: string; // IANA
}): Promise<SendResult> {
  const dateLabel = fmtDate(opts.startsAt, opts.timeZone);
  const timeLabel = `${fmtTime(opts.startsAt, opts.timeZone)} – ${fmtTime(opts.endsAt, opts.timeZone)}`;
  const html = renderEmail({
    preheader: `We missed you at “${opts.title}” — let's find a new time.`,
    heading: "Sorry we missed you",
    paragraphs: [
      `Hi ${opts.attendeeName || "there"},`,
      `We were expecting you at “${opts.title}” on ${dateLabel} at ${timeLabel} (${opts.timeZone}), but it looks like we didn't get to connect.`,
      "No problem at all — we'd love to find a new time that works for you. Just reply to this email and we'll get you rebooked.",
    ],
    footnote: "Reply to this email and we'll help you reschedule.",
  });
  return sendTransactionalEmail({ to: opts.to, subject: `We missed you — let's reschedule: ${opts.title}`, html });
}
