import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Jarvis Intelligence — F2a shared transport rate/cost guard (server-only).
 *
 * A thin, trusted wrapper over the atomic `jarvis_rate_check` RPC (0069). Identity
 * (workspaceId/userId) MUST come from `resolveJarvisContextApi` — never HTTP JSON.
 * Limits are TRUSTED SERVER CONSTANTS defined here (never caller-supplied). The RPC
 * is the sole concurrency arbiter (advisory-locked, deny-consumes-nothing). This
 * helper obtains the service-role client internally (mirroring the durable path) and
 * NEVER surfaces a raw Supabase/DB error — an infrastructure failure resolves to a
 * fail-closed result the route maps to 503, so a paid provider call can never happen
 * when the guard cannot be evaluated.
 */

/** Founder-only V1 limits. Conservative request/runaway guard (not a currency budget). */
export const RATE_LIMITS = { perMinute: 10, perHour: 120, perDay: 600 } as const;

export type RateLimitResult =
  | { ok: true; allowed: true }
  | { ok: true; allowed: false; retryAfterSeconds: number }
  | { ok: false }; // rate infrastructure unavailable → caller fails CLOSED (503)

export async function checkJarvisRateLimit(input: { workspaceId: string; userId: string }): Promise<RateLimitResult> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("jarvis_rate_check", {
      p_workspace: input.workspaceId,
      p_user: input.userId,
      p_per_minute: RATE_LIMITS.perMinute,
      p_per_hour: RATE_LIMITS.perHour,
      p_per_day: RATE_LIMITS.perDay,
    });
    if (error || data == null) return { ok: false };
    const d = data as { allowed?: unknown; retry_after?: unknown };
    if (d.allowed === true) return { ok: true, allowed: true };
    // Denied — bound Retry-After to a sane integer ≥ 1 (never trust it into the response raw).
    const raw = typeof d.retry_after === "number" ? d.retry_after : 1;
    const retryAfterSeconds = Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : 1;
    return { ok: true, allowed: false, retryAfterSeconds };
  } catch {
    // Never leak raw Supabase/DB details; fail closed.
    return { ok: false };
  }
}
