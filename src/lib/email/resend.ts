import { Resend } from "resend";

/**
 * Transactional email sender (Resend API) for app-defined notification emails.
 *
 * This is separate from Supabase Auth emails (magic link / reset / welcome),
 * which go through Supabase SMTP. Supabase cannot send arbitrary app emails, so
 * notifications are sent directly here from portal@bbettragency.com.
 *
 * Fails gracefully when RESEND_API_KEY is absent (returns ok:false) so callers
 * — and the admin actions that trigger them — never break.
 */

const FROM = "Bbettr Agency <portal@bbettragency.com>";
const REPLY_TO = "info@bbettragency.com";

export interface SendResult {
  ok: boolean;
  error?: string;
}

export async function sendTransactionalEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not configured" };
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: FROM,
      to: opts.to,
      replyTo: REPLY_TO,
      subject: opts.subject,
      html: opts.html,
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  }
}
