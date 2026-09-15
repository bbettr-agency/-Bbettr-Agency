import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNextPath } from "./auth-redirect";

/**
 * Pure planner for the auth-confirm route. Decides how to establish a session
 * from an email link's query params, supporting BOTH robust patterns:
 *   - token_hash + type → verifyOtp (device-independent; works on any browser)
 *   - code             → exchangeCodeForSession (PKCE; same-browser fallback)
 * Anything else is invalid (so we can show a friendly state instead of a vague
 * "Auth session missing" later). `next` is always sanitised against open redirects.
 */
export type RecoveryPlan =
  | { mode: "otp"; tokenHash: string; type: EmailOtpType; next: string }
  | { mode: "code"; code: string; next: string }
  | { mode: "invalid"; reason: string; next: string };

const ALLOWED_OTP_TYPES: ReadonlySet<string> = new Set([
  "recovery",
  "email",
  "signup",
  "invite",
  "magiclink",
  "email_change",
]);

type Params = URLSearchParams | { get(key: string): string | null };

export function parseRecoveryParams(params: Params): RecoveryPlan {
  const next = safeNextPath(params.get("next"));
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const code = params.get("code");

  if (tokenHash && type) {
    if (!ALLOWED_OTP_TYPES.has(type)) return { mode: "invalid", reason: "bad_type", next };
    return { mode: "otp", tokenHash, type: type as EmailOtpType, next };
  }
  if (code) return { mode: "code", code, next };
  return { mode: "invalid", reason: "missing_token", next };
}
