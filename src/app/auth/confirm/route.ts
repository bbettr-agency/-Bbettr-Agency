import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseRecoveryParams } from "@/lib/auth-recovery";

/**
 * Server-side auth confirmation (password recovery / email links).
 *
 * The email link lands here (NOT directly on /reset-password), so the recovery
 * session is established SERVER-SIDE from the link itself — independent of any
 * browser session or locally stored PKCE verifier. This is what makes recovery
 * work when the link is opened on another browser or device.
 *
 *   - token_hash + type → supabase.auth.verifyOtp (device-independent) [primary]
 *   - code             → supabase.auth.exchangeCodeForSession (same-browser) [fallback]
 *
 * On success we redirect to a sanitised same-origin `next` (default
 * /reset-password), with the session cookies set by the Supabase server client.
 * On failure we send the user to a friendly error state — never a raw token, and
 * nothing is logged that could leak one. Uses the anon server client only (RLS
 * enforced; never service-role).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const plan = parseRecoveryParams(url.searchParams);

  if (plan.mode === "invalid") {
    redirect("/reset-password?error=invalid");
  }

  const supabase = await createClient();
  const { error } =
    plan.mode === "otp"
      ? await supabase.auth.verifyOtp({ type: plan.type, token_hash: plan.tokenHash })
      : await supabase.auth.exchangeCodeForSession(plan.code);

  if (error) {
    // Do not log or forward the token/code; a generic reason is enough.
    redirect("/reset-password?error=invalid");
  }

  redirect(plan.next);
}
