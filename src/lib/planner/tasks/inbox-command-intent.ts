/**
 * Pure per-command idempotency-intent state machine for Inbox triage controls
 * (no I/O, no DOM). Dedicated to C2.1d — the locked Quick Capture intent module
 * (quick-capture-intent.ts) is NOT reused or modified.
 *
 * The idempotency key identifies one command attempt. It is reused for a safe
 * retry of the SAME submitted payload, but a payload change after a submission
 * attempt mints a NEW key (never reuse one key with two different submitted
 * payloads — the corrected Quick Capture lesson). Triage and Schedule each keep
 * their OWN intent value, so a key is never shared between the two commands.
 *
 * The "signature" is the caller's payload identity:
 *   - Triage has no variable payload → a constant signature ⇒ retries reuse the key.
 *   - Schedule's signature is the selected date ⇒ changing the date after an
 *     attempt mints a new key before the next submit.
 *
 *   Idle ──begin──▶ Draft{ key, attemptedSignature: null }
 *   Draft ──submit(sig)──▶ Draft{ key, attemptedSignature: sig }
 *   Draft ──retry same sig──▶ same key
 *   Draft ──submit(sig2 ≠ attempted)──▶ Draft{ NEW key, attemptedSignature: sig2 }
 *   Draft ──success | VersionConflict──▶ Idle
 *   Draft ──retryable failure──▶ Draft (same key)
 *   Draft ──cancel──▶ Idle
 */
import type { TaskActionResult } from "./action-result";

/** null = Idle. A Draft carries this attempt's key and the last submitted signature. */
export type CommandIntent = { key: string; attemptedSignature: string | null } | null;

export const IDLE: CommandIntent = null;

/** Begin a command intent: Idle → Draft (mints one key). An existing Draft is unchanged. */
export function beginCommandIntent(current: CommandIntent, mint: () => string): CommandIntent {
  return current ?? { key: mint(), attemptedSignature: null };
}

/**
 * Resolve the intent to submit `signature`, recording it. Reuses the key on the
 * first attempt or a same-signature retry; mints a NEW key when the signature
 * changed after a prior submission attempt.
 */
export function prepareCommandSubmit(current: CommandIntent, signature: string, mint: () => string): { key: string; attemptedSignature: string } {
  if (current && (current.attemptedSignature === null || current.attemptedSignature === signature)) {
    return { key: current.key, attemptedSignature: signature };
  }
  return { key: mint(), attemptedSignature: signature };
}

/** Cancel the intent (or clear after a terminal result) → Idle; the key is destroyed. */
export function clearCommandIntent(): CommandIntent {
  return IDLE;
}

/** Apply a disposition: "clear" → Idle; "retain" → keep the current Draft for a retry. */
export function commandIntentAfterResult(current: CommandIntent, disposition: "clear" | "retain"): CommandIntent {
  return disposition === "clear" ? IDLE : current;
}

/**
 * Map an action result to an intent disposition. SUCCESS (any outcome) clears.
 * A VersionConflict clears too — the task moved on (already triaged/scheduled by
 * someone else), so the intent is dead and the UI refreshes. Every other safe
 * failure (network, PersistenceError, InvalidCommand, TasksDisabled) is retained
 * so the user can retry the same payload under the same key.
 */
export function intentDispositionFor(result: TaskActionResult): "clear" | "retain" {
  if (result.ok) return "clear";
  if (result.code === "VersionConflict") return "clear";
  return "retain";
}
