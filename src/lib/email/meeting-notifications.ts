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
