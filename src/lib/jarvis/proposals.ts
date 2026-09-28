import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCapability } from "./capabilities";
import { canonicalEffectHash } from "./hash";
import { decide } from "./policy";
import { appendJarvisAction } from "./audit";
import { getHandler } from "./handlers";
import { isIndependentlyVerified, type VerificationResult } from "./verification";
import { GRANT_JARVIS_APPROVE, PROPOSAL_TTL_MS } from "./constants";
import type { JarvisContext } from "./identity";
import type { Json } from "@/lib/database.types";

/** The effect an approval binds to — capability + exact args. */
function effectOf(capabilityId: string, args: unknown) {
  return { capabilityId, args };
}

export type ProposalStatus = "pending" | "approved" | "rejected" | "executed" | "failed" | "expired";

/**
 * Outcome of a proposal create. With a trusted operation key (Slice F1c) the create
 * is a DB-arbitrated get-or-create:
 *   • `created`  — this call inserted the proposal row.
 *   • `reused`   — an existing proposal for this exact operation key with the SAME
 *                  immutable effect hash; its current lifecycle `status` is returned
 *                  so the caller can represent it truthfully (never invent "pending").
 *   • `conflict` — an existing proposal for this operation key with a DIFFERENT effect
 *                  hash (the same durable slot reused inconsistently). Fail closed:
 *                  no second row, no mutation, no approval, no execution.
 * Without an operation key the legacy plain-INSERT behavior is preserved and always
 * resolves to `created`.
 */
export type CreateProposalResult =
  | { outcome: "created"; id: string; effectHash: string }
  | { outcome: "reused"; id: string; effectHash: string; status: ProposalStatus }
  | { outcome: "conflict" };

export async function createProposal(
  ctx: JarvisContext,
  capabilityId: string,
  args: unknown,
  rationale?: string,
  /** Trusted, server-generated operation key (F1c). NEVER model/browser/user supplied.
   *  When present, creation is idempotent on jarvis_proposals.idempotency_key (UNIQUE). */
  operationKey?: string
): Promise<CreateProposalResult> {
  const admin = createAdminClient();
  const effect = effectOf(capabilityId, args);
  const effectHash = canonicalEffectHash(effect);
  const row = {
    workspace_id: ctx.workspaceId,
    capability_id: capabilityId,
    args: (args as Json) ?? {},
    effect: effect as unknown as Json,
    effect_hash: effectHash,
    rationale: rationale ?? null,
    status: "pending",
    initiated_by: ctx.principalId,
    is_proactive: false,
    expires_at: new Date(Date.now() + PROPOSAL_TTL_MS).toISOString(),
    ...(operationKey ? { idempotency_key: operationKey } : {}),
  };

  // Legacy path (no operation key): unchanged plain INSERT — always a new row.
  if (!operationKey) {
    const { data, error } = await admin.from("jarvis_proposals").insert(row).select("id").single();
    if (error || !data) throw new Error("could not create proposal");
    return { outcome: "created", id: data.id as string, effectHash };
  }

  // F1c get-or-create: INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING.
  // The DB UNIQUE constraint is the sole concurrency arbiter (no check-then-insert).
  const { data: inserted, error } = await admin
    .from("jarvis_proposals")
    .upsert(row, { onConflict: "idempotency_key", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error("could not create proposal");
  if (inserted && inserted.length === 1) return { outcome: "created", id: inserted[0].id as string, effectHash };

  // Lost the race / already exists → read the existing owner row by the exact key,
  // SCOPED TO THE CURRENT TRUSTED WORKSPACE. Global uniqueness arbitrates insertion;
  // trusted workspace identity arbitrates REUSE (the operation key is neither tenant
  // identity nor authorization). Compare the IMMUTABLE stored effect hash (set once,
  // never rewritten): same effect ⇒ reuse; different ⇒ deterministic conflict.
  const { data: existing, error: selErr } = await admin
    .from("jarvis_proposals")
    .select("id, effect_hash, status")
    .eq("idempotency_key", operationKey)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (selErr) throw new Error("could not create proposal");
  // The INSERT lost the global-unique race but NO reusable proposal exists in THIS
  // workspace ⇒ the key is owned by another tenant. Fail closed as a plain conflict:
  // never surface the foreign row's id/hash/status, never mutate/approve/execute it,
  // never reveal that a foreign proposal exists.
  if (!existing) return { outcome: "conflict" };
  if ((existing.effect_hash as string) !== effectHash) return { outcome: "conflict" };
  return { outcome: "reused", id: existing.id as string, effectHash, status: existing.status as ProposalStatus };
}

export type ExecuteResult =
  | { ok: true; result: unknown; verification: VerificationResult; verified: boolean }
  | { ok: false; reason: string };

export async function rejectProposal(ctx: JarvisContext, proposalId: string): Promise<{ ok: boolean; error?: string }> {
  if (!ctx.grants.has(GRANT_JARVIS_APPROVE)) return { ok: false, error: "approver_lacks_grant" };
  const admin = createAdminClient();
  const { data: p } = await admin
    .from("jarvis_proposals")
    .select("*")
    .eq("id", proposalId)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (!p || p.status !== "pending") return { ok: false, error: "not_pending" };
  await admin
    .from("jarvis_proposals")
    .update({ status: "rejected", rejected_by: ctx.principalId, rejected_at: new Date().toISOString() })
    .eq("id", proposalId)
    .eq("status", "pending");
  await appendJarvisAction({
    workspaceId: ctx.workspaceId,
    actorKind: "human",
    initiatedBy: ctx.principalId,
    capabilityId: p.capability_id,
    decision: "deny",
    proposalId,
    approvalBy: ctx.principalId,
    executed: false,
    success: false,
    detail: { rejected: true },
  });
  return { ok: true };
}

/**
 * Approve + execute a pending proposal. Re-authorises from scratch: approver
 * must hold approval authority; the proposal must be pending (single-use),
 * fresh (not expired), and its re-derived effect hash must match what was
 * approved (content unchanged); the deterministic policy must return `allow`.
 * Only then is the handler run through its legal boundary, verification recorded
 * and everything audited. Any failure ⇒ no execution.
 */
export async function approveAndExecuteProposal(ctx: JarvisContext, proposalId: string): Promise<ExecuteResult> {
  const admin = createAdminClient();
  const { data: p } = await admin
    .from("jarvis_proposals")
    .select("*")
    .eq("id", proposalId)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (!p) return { ok: false, reason: "not_found" };
  if (p.status !== "pending") return { ok: false, reason: "not_pending" }; // reused/executed/rejected

  const cap = getCapability(p.capability_id);
  const fresh = new Date(p.expires_at).getTime() > Date.now();
  const hashMatch = canonicalEffectHash(effectOf(p.capability_id, p.args)) === p.effect_hash;
  const argsValid = !!cap && cap.parse(p.args).ok;

  const decision = decide({
    authenticated: true,
    workspaceResolved: true,
    principalId: ctx.principalId,
    grantedKeys: ctx.grants,
    capability: cap
      ? { id: cap.id, riskClass: cap.riskClass, requiredGrant: cap.requiredGrant, scope: cap.scope, enabled: cap.enabled }
      : null,
    argsValid,
    scopeResolved: true,
    approval: { present: true, valid: fresh && hashMatch, approverHasGrant: ctx.grants.has(GRANT_JARVIS_APPROVE) },
  });

  if (decision.outcome !== "allow") {
    if (!fresh) await admin.from("jarvis_proposals").update({ status: "expired" }).eq("id", proposalId).eq("status", "pending");
    await appendJarvisAction({
      workspaceId: ctx.workspaceId,
      actorKind: "human",
      initiatedBy: ctx.principalId,
      capabilityId: p.capability_id,
      decision: "deny",
      riskClass: decision.riskClass ?? null,
      proposalId,
      approvalBy: ctx.principalId,
      executed: false,
      success: false,
      detail: { reason: decision.reason, fresh, hashMatch },
    });
    return { ok: false, reason: decision.reason };
  }

  // Single-use transition: pending → approved (guarded; a racing approver loses).
  const { data: claimed } = await admin
    .from("jarvis_proposals")
    .update({ status: "approved", approved_by: ctx.principalId, approved_at: new Date().toISOString() })
    .eq("id", proposalId)
    .eq("status", "pending")
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: false, reason: "race_not_pending" };

  const handler = getHandler(p.capability_id);
  if (!handler) {
    await admin.from("jarvis_proposals").update({ status: "failed", error: "no_handler" }).eq("id", proposalId);
    await appendJarvisAction({ workspaceId: ctx.workspaceId, actorKind: "human", initiatedBy: ctx.principalId, capabilityId: p.capability_id, decision: "allow", proposalId, approvalBy: ctx.principalId, executed: false, success: false, error: "no_handler" });
    return { ok: false, reason: "no_handler" };
  }

  try {
    const result = await handler(ctx, p.args);
    const verified = isIndependentlyVerified(result.verification);
    await admin
      .from("jarvis_proposals")
      .update({
        status: "executed",
        executed_at: new Date().toISOString(),
        verification_state: result.verification.state,
        verification_evidence: (result.verification.evidence as unknown as Json) ?? null,
      })
      .eq("id", proposalId)
      .eq("status", "approved");
    await appendJarvisAction({
      workspaceId: ctx.workspaceId,
      actorKind: "human",
      initiatedBy: ctx.principalId,
      capabilityId: p.capability_id,
      decision: "allow",
      riskClass: decision.riskClass ?? null,
      proposalId,
      approvalBy: ctx.principalId,
      executed: true,
      success: true,
      verificationState: result.verification.state,
      evidence: result.verification.evidence,
      detail: { verified },
    });
    return { ok: true, result: result.data, verification: result.verification, verified };
  } catch (e) {
    // Execution attempted but the underlying operation FAILED (the handler threw,
    // including when the Planner command returned { ok:false }). Record the truth:
    // proposal → failed (never a state implying success), verification → failed,
    // and the specific safe message. The single-use pending→approved claim above
    // already fired, so the proposal cannot be re-approved/retried.
    const msg = e instanceof Error ? e.message : "execution_failed";
    await admin.from("jarvis_proposals").update({ status: "failed", error: msg, verification_state: "failed" }).eq("id", proposalId);
    await appendJarvisAction({ workspaceId: ctx.workspaceId, actorKind: "human", initiatedBy: ctx.principalId, capabilityId: p.capability_id, decision: "allow", proposalId, approvalBy: ctx.principalId, executed: true, success: false, verificationState: "failed", error: msg });
    return { ok: false, reason: "execution_failed" };
  }
}
