/**
 * Quick Capture "capture-intent" state machine (pure, no I/O, no DOM).
 *
 * The idempotency key belongs to the user's CAPTURE SESSION, not the text. A
 * single key is minted when a capture intent begins and is kept for the whole
 * attempt — across edits and retries — because editing "Call supplier" into
 * "Call supplier tomorrow" and retrying is still the SAME logical capture. The
 * server computes the payload hash and detects genuine conflicts if needed; the
 * client never regenerates the key just because the draft changed.
 *
 *   Idle ──begin──▶ Draft(key)
 *   Draft ──edit/retry──▶ Draft(same key)
 *   Draft ──success──▶ Idle            (a brand-new capture mints a fresh key)
 *   Draft ──Escape (cancel)──▶ Idle    (the key is destroyed)
 *
 * These pure helpers hold the whole lifecycle so it is unit-testable without a
 * DOM; the client component is a thin shell over them.
 */

/** null = Idle (no active capture). An object = Draft holding this session's key. */
export type CaptureIntent = { key: string } | null;

export const IDLE: CaptureIntent = null;

/**
 * Ensure an active capture intent exists. Idle → Draft (mints exactly one key);
 * Draft → the SAME Draft (never re-mints — an edit/retry keeps the key). `mint`
 * is only called when transitioning out of Idle.
 */
export function beginIntent(current: CaptureIntent, mint: () => string): CaptureIntent {
  return current ?? { key: mint() };
}

/** Cancel the intent (Escape) or clear after success → Idle; the key is destroyed. */
export function clearIntent(): CaptureIntent {
  return IDLE;
}

/**
 * The intent after an action result: SUCCESS (any outcome — applied /
 * accepted_noop / replayed) destroys the key (→ Idle); a FAILURE keeps the same
 * key so the retry replays under the same session identity.
 */
export function intentAfterResult(current: CaptureIntent, ok: boolean): CaptureIntent {
  return ok ? IDLE : current;
}

/** Client-side draft validation: trim; reject empty / whitespace-only titles. */
export function validateDraft(raw: string): { ok: true; title: string } | { ok: false } {
  const title = raw.trim();
  return title.length > 0 ? { ok: true, title } : { ok: false };
}
