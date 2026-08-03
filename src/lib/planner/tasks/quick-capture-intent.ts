/**
 * Quick Capture "capture-intent" state machine (pure, no I/O, no DOM).
 *
 * The idempotency key identifies one capture attempt. It is REUSED for a safe
 * retry of the SAME submitted payload, but a payload change AFTER a submission
 * attempt must mint a NEW key — because the client cannot distinguish "the
 * request never reached the server" from "the request committed but its response
 * was lost". The persistence op returns IdempotencyConflict on same-key +
 * different-payload once a receipt exists, so reusing one key across two
 * different submitted titles is unsafe.
 *
 * A Draft therefore tracks the last SUBMITTED (trimmed) title:
 *
 *   Idle ──begin──▶ Draft{ key, attemptedTitle: null }        (first interaction)
 *   Draft ──edit before first submit──▶ same Draft            (key kept, not yet attempted)
 *   Draft ──submit(t)──▶ Draft{ key, attemptedTitle: t }      (records the attempt)
 *   Draft ──retry same t──▶ same key                          (safe replay)
 *   Draft ──submit(t2 ≠ attemptedTitle)──▶ Draft{ NEW key, attemptedTitle: t2 }
 *   Draft ──success (applied|accepted_noop|replayed)──▶ Idle
 *   Draft ──Escape──▶ Idle
 *
 * Titles are compared TRIMMED, so whitespace-only edits never mint a new key.
 * These pure helpers hold the whole lifecycle so it is unit-testable without a
 * DOM; the client component is a thin shell over them.
 */

/** null = Idle. A Draft carries this attempt's key and the last submitted (trimmed) title. */
export type CaptureIntent = { key: string; attemptedTitle: string | null } | null;

export const IDLE: CaptureIntent = null;

/**
 * Begin a capture on first interaction: Idle → Draft (mints exactly one key, not
 * yet attempted). An existing Draft is returned unchanged — editing BEFORE the
 * first submit keeps the same key. `mint` is only called when leaving Idle.
 */
export function beginIntent(current: CaptureIntent, mint: () => string): CaptureIntent {
  return current ?? { key: mint(), attemptedTitle: null };
}

/**
 * Resolve the intent to use for submitting `trimmedTitle`, recording it as the
 * attempted title. Reuses the current key when this is the first attempt or a
 * retry of the SAME submitted title; mints a NEW key when the title has changed
 * after a prior submission attempt (never reuse one key with two payloads).
 */
export function prepareSubmit(current: CaptureIntent, trimmedTitle: string, mint: () => string): { key: string; attemptedTitle: string } {
  if (current && (current.attemptedTitle === null || current.attemptedTitle === trimmedTitle)) {
    return { key: current.key, attemptedTitle: trimmedTitle };
  }
  return { key: mint(), attemptedTitle: trimmedTitle };
}

/** Cancel (Escape) or clear after success → Idle; the key is destroyed. */
export function clearIntent(): CaptureIntent {
  return IDLE;
}

/**
 * The intent after an action result: SUCCESS (any outcome) destroys the key
 * (→ Idle); a FAILURE keeps the current Draft so a same-title retry replays under
 * the same key (and an edited retry mints a new one via prepareSubmit).
 */
export function intentAfterResult(current: CaptureIntent, ok: boolean): CaptureIntent {
  return ok ? IDLE : current;
}

/** Client-side draft validation: trim; reject empty / whitespace-only titles. */
export function validateDraft(raw: string): { ok: true; title: string } | { ok: false } {
  const title = raw.trim();
  return title.length > 0 ? { ok: true, title } : { ok: false };
}
