import "server-only";
import { createClient } from "@/lib/supabase/server";
import { sendTransactionalEmail } from "@/lib/email/resend";
import { renderEmail } from "@/lib/email/templates";
import type { NotificationType } from "@/lib/database.types";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.bbettragency.com";

export interface NotifyInput {
  clientId: string;
  type: NotificationType;
  /** Notification title — also the email subject + heading by default. */
  title: string;
  /** Body copy — also the email's first paragraph by default. */
  body?: string;
  /** In-portal path the notification links to, e.g. "/dashboard/reports". */
  link?: string;
  actionRequired?: boolean;
  /** Optional email overrides; set send:false to record a DB-only notification. */
  email?: {
    heading?: string;
    paragraphs?: string[];
    ctaLabel?: string;
    send?: boolean;
  };
}

/**
 * The single notification choke point: Event → DB notification → email.
 *
 * 1. Writes a durable `notifications` row (powers the in-portal feed + future
 *    Supabase Realtime).
 * 2. Sends a branded transactional email via Resend.
 *
 * Best-effort and non-throwing: a failure here must never break the admin
 * action that triggered it. Runs in the caller's (admin) RLS context.
 *
 * Adding a new notification type only needs a new NotificationType enum value
 * and a call site — no changes here.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const supabase = await createClient();

    // 1. Durable notification record.
    await supabase.from("notifications").insert({
      client_id: input.clientId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      action_required: input.actionRequired ?? false,
    });

    // 2. Email (unless explicitly suppressed).
    if (input.email?.send === false) return;

    const { data: client } = await supabase
      .from("clients")
      .select("name, contact_email")
      .eq("id", input.clientId)
      .single();

    if (!client?.contact_email) return;

    const firstName = (client.name ?? "there").split(/\s+/).slice(-1)[0];
    const paragraphs =
      input.email?.paragraphs ??
      [
        `Hi ${firstName},`,
        input.body ?? input.title,
      ].filter(Boolean);

    const html = renderEmail({
      preheader: input.title,
      heading: input.email?.heading ?? input.title,
      paragraphs,
      cta: {
        label: input.email?.ctaLabel ?? "View in your portal",
        url: `${APP_URL}${input.link ?? "/dashboard"}`,
      },
      footnote: input.actionRequired
        ? "This needs your attention to keep your project moving."
        : undefined,
    });

    await sendTransactionalEmail({
      to: client.contact_email,
      subject: input.title,
      html,
    });
  } catch {
    // Swallow — notifications are best-effort and must not break the caller.
  }
}
