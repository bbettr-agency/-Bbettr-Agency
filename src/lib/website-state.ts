/**
 * Pure derivation of the Bbettr-built website's display state (Slice 2D) — no
 * I/O, no JSX. One source of truth (clients.website_preview_url +
 * website_live_url) drives BOTH the admin read-only line and the client Home
 * card, so the URL is never maintained twice.
 *
 * Precedence: a live URL means the site is Live (even if a preview also exists);
 * otherwise a preview URL means In Development; otherwise there is nothing to
 * show. Blank/whitespace values are treated as absent.
 */
export type WebsiteState = "none" | "preview" | "live";

export interface WebsiteView {
  state: WebsiteState;
  /** The single URL a call-to-action should open (live wins, else preview). */
  url: string | null;
  previewUrl: string | null;
  liveUrl: string | null;
}

function clean(u: string | null | undefined): string | null {
  if (typeof u !== "string") return null;
  const t = u.trim();
  return t.length > 0 ? t : null;
}

export function deriveWebsiteState(input: {
  previewUrl?: string | null;
  liveUrl?: string | null;
}): WebsiteView {
  const liveUrl = clean(input.liveUrl);
  const previewUrl = clean(input.previewUrl);
  if (liveUrl) return { state: "live", url: liveUrl, previewUrl, liveUrl };
  if (previewUrl) return { state: "preview", url: previewUrl, previewUrl, liveUrl: null };
  return { state: "none", url: null, previewUrl, liveUrl };
}

/**
 * A URL is acceptable to store only if it is a well-formed http(s) URL. Empty
 * input is allowed (it clears the field); anything else non-empty must parse.
 */
export function isStorableUrl(raw: string): boolean {
  const t = raw.trim();
  if (t.length === 0) return true; // clearing the field
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
