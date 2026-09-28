import "server-only";

import { createMemory, type MemoryActor, type MemoryCreateInput, type MemoryWriteResult } from "@/lib/jarvis/memory/store";
import { isMemoryCategory } from "@/lib/jarvis/memory/types";
import { canonicalEffectHash } from "@/lib/jarvis/hash";
import { GRANT_JARVIS_APPROVE, GRANT_MEMORY_PROPOSE } from "@/lib/jarvis/constants";
import type { JarvisContext } from "@/lib/jarvis/identity";
import type { ContextPlan, ValidatedMemoryCandidate } from "./types";

/**
 * Jarvis Intelligence — MEMORY BRIDGE (Slice D, server-only).
 *
 * Turns an UNTRUSTED, Slice-C-validated `memory_candidate` into a request against
 * the EXISTING Memory create path (`createMemory`). The model supplies ONLY
 * scope/category/claim/body; trusted code binds ALL identity and provenance:
 *   • workspace/user/client ids come from the reauthorized context + deterministic
 *     Slice-C routing — never from the model;
 *   • sourceKind is forced to `model_inference`, so `decideIngestion` records the
 *     row as state `inferred` (not-yet-truth) and it can NEVER be silently
 *     confirmed — explicit human confirmation stays a separate operation;
 *   • the existing secret scan runs inside `createMemory` (reused, not reinvented).
 *
 * This bridge does NOT confirm, supersede, retire, or auto-dedupe memory. It only
 * proposes a candidate. Reauthorization (TOCTOU) is done by the caller, which
 * passes a fresh, consistency-checked context here.
 */

/** Provenance label for model-proposed memory (the authoritative provenance is
 *  the `model_inference` source kind; this is only a human-readable tag). */
export const MEMORY_MODEL_DISPLAY = "Jarvis (model inference)";

export type MemoryBridgeResult =
  | { status: "not_requested" }
  | { status: "rejected"; reason: string; secretCategories?: string[] }
  | { status: "unauthorized"; reason: string }
  | { status: "needs_confirmation"; memoryId: string; state: string }
  | { status: "failed"; reason: string };

/**
 * Deterministic SHA-256 (lowercase hex) of the LOCKED semantic Memory effect envelope
 * (F1c). Identifies the intended effect for operation-key idempotency. Binds every
 * trusted identity field so operation-key reuse can NEVER silently widen
 * workspace/scope/client/user, or change category/claim/body. Deliberately EXCLUDES
 * the operation key, requestId, sourceRef, timestamps, generated id, and provider
 * metadata. Claim is trimmed to match the stored canonical claim; body normalizes to
 * null. Reuses the existing key-sorted stable-JSON primitive.
 */
export function memoryEffectHash(env: {
  workspaceId: string;
  scope: string;
  clientId: string | null;
  userId: string | null;
  category: string;
  claim: string;
  body: string | null;
}): string {
  return canonicalEffectHash({
    v: 1,
    workspaceId: env.workspaceId,
    scope: env.scope,
    clientId: env.clientId,
    userId: env.userId,
    category: env.category,
    claim: env.claim.trim(),
    body: env.body ?? null,
  });
}

export interface MemoryBridgeDeps {
  /** Defaults to the real Memory create path. */
  create?: (actor: MemoryActor, input: MemoryCreateInput) => Promise<MemoryWriteResult>;
}

export interface MemoryBridgeInput {
  /** The freshly reauthorized, consistency-checked context (from the orchestrator). */
  ctx: JarvisContext;
  candidate: ValidatedMemoryCandidate | undefined;
  /** The turn's deterministic context plan — the ONLY source of a client binding. */
  plan: ContextPlan;
  /** Trusted turn correlation id (stored in source_ref; never a model value). */
  requestId: string;
  /** Trusted, server-generated F1c operation key (`turn:<turnId>:memory:0`). Absent on
   *  the legacy keyless path. NEVER model/browser/user supplied. Distinct from
   *  requestId (correlation) and from source_ref (provenance). */
  operationKey?: string;
}

export async function bridgeMemoryCandidate(input: MemoryBridgeInput, deps: MemoryBridgeDeps = {}): Promise<MemoryBridgeResult> {
  const { ctx, candidate, plan, requestId, operationKey } = input;
  if (!candidate) return { status: "not_requested" };

  const create = deps.create ?? createMemory;

  // Authorization: proposing memory requires the same grant the manual propose
  // action requires. (The reauthorized context is supplied by the orchestrator.)
  if (!ctx.grants.has(GRANT_MEMORY_PROPOSE)) {
    return { status: "unauthorized", reason: "missing_memory_propose" };
  }

  // Revalidate the category at the MUTATION boundary — never trust the earlier
  // Slice-C parse of stale model output.
  if (!isMemoryCategory(candidate.category)) {
    return { status: "rejected", reason: "invalid_category" };
  }

  // Deterministic, trusted scope binding. The model never controls ids.
  let clientId: string | null = null;
  let userId: string | null = null;
  if (candidate.scope === "agency") {
    // bound to the current agency workspace (actor.workspaceId); no client/user.
  } else if (candidate.scope === "user") {
    userId = ctx.principalId; // authenticated principal only
  } else if (candidate.scope === "client") {
    // ONLY valid when Slice-C deterministically resolved an authorized client.
    if (plan.kind !== "client") {
      return { status: "rejected", reason: "client_scope_without_resolved_client" };
    }
    clientId = plan.clientId; // trusted, deterministically resolved id
  } else {
    return { status: "rejected", reason: "invalid_scope" };
  }

  const actor: MemoryActor = {
    principalId: ctx.principalId,
    workspaceId: ctx.workspaceId,
    display: MEMORY_MODEL_DISPLAY,
    hasApproveAuthority: ctx.grants.has(GRANT_JARVIS_APPROVE),
  };

  // F1c: when a trusted operation key is present, bind idempotency to the LOCKED
  // semantic effect envelope. Computed AFTER trusted scope binding, so client/user are
  // the deterministic ids (never model values). Absent key ⇒ legacy non-idempotent create.
  const idemEffectHash = operationKey
    ? memoryEffectHash({
        workspaceId: ctx.workspaceId,
        scope: candidate.scope,
        clientId,
        userId,
        category: candidate.category,
        claim: candidate.claim,
        body: candidate.body ?? null,
      })
    : undefined;

  let res: MemoryWriteResult;
  try {
    res = await create(actor, {
      scope: candidate.scope,
      category: candidate.category,
      claim: candidate.claim,
      body: candidate.body ?? null,
      clientId,
      userId,
      sourceKind: "model_inference", // forces `inferred` state via decideIngestion
      sourceRef: `jarvis:turn:${requestId}`, // trusted correlation (existing column; unchanged)
      idempotencyKey: operationKey,
      idemEffectHash,
    });
  } catch {
    return { status: "failed", reason: "bridge_invocation_failed" };
  }

  if (!res.ok) {
    // Same operation key + DIFFERENT semantic effect (0068 BB68C): an internal invariant
    // failure, not a content rejection. Fail closed (no second memory), stay truthful.
    if (res.reason === "idempotency_conflict") return { status: "failed", reason: "idempotency_conflict" };
    // Includes secret rejection, portal-owned-value rejection, scope errors, etc.
    return { status: "rejected", reason: res.reason, secretCategories: res.secretCategories };
  }

  // Model-origin memory is never auto-truth: it enters as `inferred` and requires
  // explicit, separate human confirmation before it becomes durable knowledge.
  return { status: "needs_confirmation", memoryId: res.id, state: res.state };
}
