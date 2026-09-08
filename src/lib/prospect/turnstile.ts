import "server-only";

/**
 * Server-only Cloudflare Turnstile verification (P2-C).
 *
 * The secret NEVER reaches the browser. The site key is public
 * (NEXT_PUBLIC_TURNSTILE_SITE_KEY, matching the repo's NEXT_PUBLIC_* convention).
 * Protected mutations FAIL CLOSED: if the secret is unset, verification reports
 * `configured:false` and the caller returns a configuration error — a missing
 * env var can never silently bypass the check (important: main auto-deploys).
 */
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 8000;

export interface TurnstileResult {
  /** Cloudflare confirmed success === true. */
  ok: boolean;
  /** The server secret is present (false ⇒ fail-closed configuration error). */
  configured: boolean;
}

/** Is the server able to verify Turnstile at all? */
export function isTurnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

/**
 * Verify a Turnstile token against Cloudflare siteverify. Never throws — returns
 * a typed result. Any missing token, network error, non-2xx, malformed body, or
 * success!==true resolves to `{ ok:false }`. Optionally passes the client IP.
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  opts: { remoteIp?: string | null } = {}
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: false, configured: false }; // fail closed
  if (!token || typeof token !== "string") return { ok: false, configured: true };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (opts.remoteIp) body.set("remoteip", opts.remoteIp);
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, configured: true };
    const json = (await res.json().catch(() => null)) as { success?: boolean } | null;
    return { ok: json?.success === true, configured: true };
  } catch {
    return { ok: false, configured: true }; // network/timeout/abort → fail closed
  } finally {
    clearTimeout(timer);
  }
}
