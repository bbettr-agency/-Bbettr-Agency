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
