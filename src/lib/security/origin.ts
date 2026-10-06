import "server-only";

/**
 * Trusted-origin / CSRF defense for sensitive same-origin POST endpoints.
 *
 * The trusted-origin allowlist is derived ONLY from server-side platform metadata
 * — never from request-controlled headers (Host / X-Forwarded-Host / Origin are
 * never used as a SOURCE of trust). The incoming `Origin` header is only ever
 * COMPARED against that allowlist.
 *
 * Trusted origins:
 *   - NEXT_PUBLIC_APP_URL           → the canonical production app origin.
 *   - VERCEL_PROJECT_PRODUCTION_URL → the project's production domain (Vercel-set).
 *   - VERCEL_URL                    → THIS deployment's immutable URL (Vercel-set).
 *   - VERCEL_BRANCH_URL             → THIS deployment's branch alias (Vercel-set).
 *
 * The VERCEL_* values are Vercel System Environment Variables injected by the
 * platform at runtime — not user-controllable — so a Preview deployment trusts its
 * OWN generated origin automatically (no manual NEXT_PUBLIC_APP_URL per redeploy),
 * while a DIFFERENT deployment's origin is still rejected (we only ever trust the
 * metadata of the deployment actually running). We never allow `*.vercel.app`
 * wholesale.
 *
 * Policy (unchanged from the original Jarvis guard, now shared):
 *   - a cross-site Sec-Fetch-Site is always rejected;
 *   - an Origin present but not in the allowlist is rejected;
 *   - an Origin present while NO trusted origin is resolvable fails CLOSED;
 *   - no Origin at all proceeds to cookie/session auth (not a bypass).
 */

type EnvLike = Record<string, string | undefined>;

function toOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

/** The set of origins this running deployment trusts, from platform metadata only. */
export function trustedOrigins(env: EnvLike = process.env): string[] {
  const out = new Set<string>();
  for (const v of [
    env.NEXT_PUBLIC_APP_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.VERCEL_URL,
    env.VERCEL_BRANCH_URL,
  ]) {
    const o = toOrigin(v);
    if (o) out.add(o);
  }
  return [...out];
}

/** Returns true when the request must be rejected on origin/fetch-metadata grounds. */
export function isBadOrigin(req: Request, env: EnvLike = process.env): boolean {
  const sfs = req.headers.get("sec-fetch-site");
  if (sfs && sfs !== "same-origin" && sfs !== "same-site" && sfs !== "none") return true;

  const origin = req.headers.get("origin");
  if (!origin) return false; // no Origin ⇒ fall through to cookie/session auth (not a bypass)

  const trusted = trustedOrigins(env);
  if (trusted.length === 0) return true; // Origin present but nothing trusted resolvable ⇒ fail closed
  return !trusted.includes(origin);
}
