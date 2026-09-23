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

export async function createProposal(
  ctx: JarvisContext,
  capabilityId: string,
  args: unknown,
  rationale?: string
): Promise<{ id: string; effectHash: string }> {
  const admin = createAdminClient();
  const effect = effectOf(capabilityId, args);
  const effectHash = canonicalEffectHash(effect);
  const { data, error } = await admin
    .from("jarvis_proposals")
    .insert({
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
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("could not create proposal");
  return { id: data.id as string, effectHash };
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
