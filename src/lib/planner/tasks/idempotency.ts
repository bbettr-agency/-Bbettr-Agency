/**
 * Idempotency-key helper for future Tasks UI.
 *
 * Client-compatible (uses the Web Crypto `crypto.randomUUID`, available in
 * browsers and Node ≥19) — NOT server-only. It generates a key only; it invokes
 * no command and carries no actor/workspace/task content.
 *
 * CONTRACT for future client components:
 *   - Generate ONE key per new user intent (e.g. when the user opens the
 *     "create task" form, or first clicks "Complete" on a row).
 *   - Hold that key in component state for the lifetime of that intent.
 *   - On a RETRY of the exact same intent (e.g. the request failed and the user
 *     clicks again), REUSE the same key so the persistence op can replay/dedupe.
 *   - Only generate a NEW key when the user starts a genuinely new intent.
 *   - Never derive the key from task content and never regenerate it mid-retry.
 *
 * Example:
 *   const keyRef = useRef<string>(newIdempotencyKey()); // one intent
 *   // ...submit uses keyRef.current; a retry reuses it; a new form gets a new key.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
