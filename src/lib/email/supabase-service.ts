import { createClient } from "@/lib/supabase/server";
import type { EmailKind, EmailResult, PortalEmailService } from "./types";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.bbettragency.com";

/**
 * V1 email provider built on Supabase Auth's built-in emails.
 *
 * - welcome / resend_credentials → a passwordless **magic-link access email**
 *   (`signInWithOtp`): "click to access your Bbettr Agency portal". This is a
 *   genuine welcome/invite, distinct from a password reset.
 * - password_reset → Supabase's **"reset your password"** email.
 *
 * Note: Supabase cannot email a plaintext password (only the admin-generated
 * temporary password — see resetTempPasswordAction — can be shared, and it's
 * never sent by email). V2 can swap this for branded Resend emails by
 * implementing PortalEmailService elsewhere; callers don't change.
 */
export const supabaseEmailService: PortalEmailService = {
  async send(kind: EmailKind, email: string): Promise<EmailResult> {
    const supabase = await createClient();

    if (kind === "password_reset") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${APP_URL}/reset-password`,
      });
      return error ? { ok: false, error: error.message } : { ok: true };
    }

    // welcome | resend_credentials → passwordless access (magic link)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${APP_URL}/dashboard`,
      },
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  },
};
