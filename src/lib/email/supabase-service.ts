import { createClient } from "@/lib/supabase/server";
import type { EmailKind, EmailResult, PortalEmailService } from "./types";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.bbettragency.com";

/**
 * V1 email provider built on Supabase Auth's built-in emails.
 *
 * All three kinds currently send Supabase's secure "set / reset your password"
 * link (which works for both brand-new and existing logins). The distinct kinds
 * are preserved so a future Resend provider can send branded, purpose-specific
 * emails (welcome vs. reminder vs. reset) without changing callers.
 */
export const supabaseEmailService: PortalEmailService = {
  async send(_kind: EmailKind, email: string): Promise<EmailResult> {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${APP_URL}/reset-password`,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
};
