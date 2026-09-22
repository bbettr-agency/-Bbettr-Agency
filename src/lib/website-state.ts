/**
 * Pure derivation of the Bbettr-built website's display state — no I/O, no JSX.
 * The same clients.website_preview_url + website_live_url drive BOTH the admin
 * read-only line and the client Home card, so a URL is never maintained twice.
 *
 * CANONICAL RULE (CX1): whether a site is "Live" is decided by PROJECT STAGES
 * (the Launch stage being completed), NOT by the mere presence of a live URL —
 * the URLs are supporting CTAs, not lifecycle truth. So a live URL set before
 * Launch is complete does NOT show as Live (it's flagged via `dataWarning` for
 * an admin to reconcile), which keeps the website card and the project journey
 * from contradicting each other. Blank/whitespace values are treated as absent.
 */
export type WebsiteState = "none" | "preview" | "live";

export interface WebsiteView {
  state: WebsiteState;
  /** The single URL a call-to-action should open (live wins, else preview). */
  url: string | null;
  previewUrl: string | null;
  liveUrl: string | null;
  /** A live URL exists but the project hasn't launched — data to reconcile. */
  dataWarning?: "live_url_without_launch";
}

function clean(u: string | null | undefined): string | null {
  if (typeof u !== "string") return null;
  const t = u.trim();
  return t.length > 0 ? t : null;
}

export function deriveWebsiteState(input: {
  previewUrl?: string | null;
  liveUrl?: string | null;
  /** Canonical: the project's Launch stage is completed. Default false. */
  launched?: boolean;
}): WebsiteView {
  const liveUrl = clean(input.liveUrl);
  const previewUrl = clean(input.previewUrl);
  const launched = input.launched === true;

  if (launched) {
    // Launched per project stages → Live; open the live URL (fall back to preview).
    return { state: "live", url: liveUrl ?? previewUrl, previewUrl, liveUrl };
  }
  // Not launched: a live URL alone does NOT mean live. Any URL shows the site as
  // In Development (openable); a stray live URL is flagged for reconciliation.
  const url = previewUrl ?? liveUrl;
  if (url) {
    return {
      state: "preview",
      url,
      previewUrl,
      liveUrl,
      ...(liveUrl ? { dataWarning: "live_url_without_launch" as const } : {}),
    };
  }
  return { state: "none", url: null, previewUrl, liveUrl };
}

/** Whether the client "Your Website" card should render (a real URL exists). */
export function hasWebsite(view: WebsiteView): view is WebsiteView & { url: string } {
  return view.state !== "none" && view.url !== null;
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
