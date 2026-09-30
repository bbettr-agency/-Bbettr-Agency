import { Resend } from "resend";

/**
 * Transactional email sender (Resend API) for app-defined notification emails.
 *
 * This is separate from Supabase Auth emails (magic link / reset / welcome),
 * which go through Supabase SMTP. Supabase cannot send arbitrary app emails, so
 * notifications are sent directly here from portal@bbettragency.com — the
 * authenticated, DMARC-aligned Bbettr sending identity.
 *
 * Fails gracefully when RESEND_API_KEY is absent (returns ok:false) so callers
 * — and the admin actions that trigger them — never break.
 */

const FROM = "Bbettr Agency <portal@bbettragency.com>";
const REPLY_TO = "info@bbettragency.com";

export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

export interface SendResult {
  ok: boolean;
  /** Resend message id, when the send was accepted. Used to correlate webhooks. */
  id?: string;
  error?: string;
}

export async function sendTransactionalEmail(opts: {
  to: string;
  subject: string;
  html: string;
  /** Override the default From display name (address stays portal@bbettragency.com). */
  fromName?: string;
  /** Override the default Reply-To (defaults to info@bbettragency.com). */
  replyTo?: string;
  attachments?: EmailAttachment[];
  /** Provider-level idempotency key (deterministic) to dedupe retried sends. */
  idempotencyKey?: string;
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not configured" };
  }

  const from = opts.fromName
    ? `${opts.fromName.replace(/[\r\n]+/g, " ").trim()} <portal@bbettragency.com>`
    : FROM;

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send(
      {
        from,
        to: opts.to,
        replyTo: opts.replyTo ?? REPLY_TO,
        subject: opts.subject,
        html: opts.html,
        ...(opts.attachments && opts.attachments.length > 0
          ? { attachments: opts.attachments }
          : {}),
      },
      opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  }
}
