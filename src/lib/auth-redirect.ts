/**
 * Open-redirect protection for post-auth navigation. A `next` value coming from a
 * URL is only trusted when it is a same-origin ABSOLUTE PATH — never an absolute
 * URL, protocol-relative (`//host`), backslash-tricked (`/\host`), or a scheme
 * like `javascript:`. Anything else falls back to a safe default.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/reset-password"): string {
  if (typeof next !== "string" || next.length === 0) return fallback;
  // Must be an absolute path…
  if (!next.startsWith("/")) return fallback;
  // …but not protocol-relative or backslash-tricked ("//x", "/\x").
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  // Defense in depth: reject anything that still parses as having a scheme/host.
  if (/^\/[^/]*:/.test(next)) return fallback; // e.g. "/x:evil"
  return next;
}
