/**
 * Jarvis verification contract (Foundation 1). Pure interface + guard.
 *
 * Jarvis must NEVER claim an action occurred (or a task is complete) without
 * independent EVIDENCE. This module defines the state model and the single
 * deterministic guard that enforces it. External verification ADAPTERS
 * (GitHub/Vercel/etc.) are intentionally NOT built here.
 */
import type { VerificationState } from "./types";

export interface VerificationResult {
  state: VerificationState;
  /** Evidence is REQUIRED for `verified`; absent otherwise. */
  evidence?: unknown;
}

/**
 * A verifier independently checks that an asserted outcome really happened.
 * Foundation 1 registers NONE — so any capability that requires verification
 * resolves to `unavailable` and must not be reported as success.
 */
export interface Verifier {
  readonly id: string;
  verify(context: unknown): Promise<VerificationResult>;
}

/** No adapters in Foundation 1. */
export const VERIFIERS: Readonly<Record<string, Verifier>> = Object.freeze({});

/**
 * THE guard: a result may be treated as independently verified ONLY when its
 * state is exactly 'verified' AND it carries evidence. "reported" (a system said
 * so), "pending", "failed", "unavailable" are never success. Pure.
 */
export function isIndependentlyVerified(result: VerificationResult): boolean {
  return result.state === "verified" && result.evidence !== undefined && result.evidence !== null;
}

/**
 * Resolve verification for a capability outcome. With no registered verifier for
 * a required check, returns `unavailable` (fail-safe: never claims success).
 */
export async function resolveVerification(
  verifierId: string | null,
  context: unknown
): Promise<VerificationResult> {
  if (!verifierId) return { state: "not_required" };
  const verifier = VERIFIERS[verifierId];
  if (!verifier) return { state: "unavailable" };
  try {
    return await verifier.verify(context);
  } catch {
    return { state: "failed" };
  }
}
