import "server-only";

import { getCapability } from "./capabilities";
import { decide } from "./policy";
import { appendJarvisAction } from "./audit";
import { getHandler } from "./handlers";
import { createProposal } from "./proposals";
import type { JarvisContext } from "./identity";
import type { VerificationResult } from "./verification";

/**
 * The SINGLE entrypoint for invoking a Jarvis capability (Foundation 1). The
 * future LLM/UI calls this with an already-authenticated JarvisContext + a
 * capability id + raw args; it NEVER receives credentials or a generic tool.
 *
 * Flow: registry lookup → validate args → deterministic policy → audit the
 * decision (before any side effect; a failed audit throws and nothing executes)
 * → route: auto=execute, confirm/destructive=create a pending proposal,
 * monitor=read-only, deny=refuse.
 */
export type InvokeResult =
  | { status: "allow"; result: unknown; verification: VerificationResult }
  | { status: "monitor_only"; result: unknown; verification: VerificationResult }
  | { status: "needs_approval"; proposalId: string }
  | { status: "deny"; reason: string }
  | { status: "error"; reason: string };

export async function invokeCapability(
  ctx: JarvisContext,
  capabilityId: string,
  rawArgs: unknown,
  opts: { rationale?: string; targetClientId?: string | null } = {}
): Promise<InvokeResult> {
  const cap = getCapability(capabilityId);
  const parsed = cap ? cap.parse(rawArgs) : ({ ok: false, error: "unregistered" } as const);

  const decision = decide({
    authenticated: true, // ctx came from requireJarvisUser (admin + workspace + jarvis.use)
    workspaceResolved: true,
    principalId: ctx.principalId,
    grantedKeys: ctx.grants,
    capability: cap
      ? { id: cap.id, riskClass: cap.riskClass, requiredGrant: cap.requiredGrant, scope: cap.scope, enabled: cap.enabled }
      : null,
    argsValid: parsed.ok,
    // Foundation-1 capabilities are agency-scoped; a client-scoped capability
    // would require a resolved, authorised client id here (none ship in F1).
    scopeResolved: cap ? cap.scope === "agency" : false,
  });

  // Audit the DECISION before any side effect. A failed audit throws → nothing runs.
  await appendJarvisAction({
    workspaceId: ctx.workspaceId,
    actorKind: "human",
    initiatedBy: ctx.principalId,
    capabilityId,
    decision: decision.outcome,
    riskClass: decision.riskClass ?? null,
    targetClientId: opts.targetClientId ?? null,
    executed: false,
    detail: { reason: decision.reason },
  });

  if (decision.outcome === "deny") return { status: "deny", reason: decision.reason };

  if (decision.outcome === "needs_approval") {
    const { id } = await createProposal(ctx, capabilityId, (parsed as { args: unknown }).args, opts.rationale);
    return { status: "needs_approval", proposalId: id };
  }

  const handler = getHandler(capabilityId);
  if (!handler) return { status: "deny", reason: "no_handler" };
  const args = (parsed as { args: unknown }).args;

  try {
    const r = await handler(ctx, args);
    await appendJarvisAction({
      workspaceId: ctx.workspaceId,
      actorKind: "human",
      initiatedBy: ctx.principalId,
      capabilityId,
      decision: decision.outcome,
      riskClass: decision.riskClass ?? null,
      targetClientId: opts.targetClientId ?? null,
      executed: true,
      success: true,
      verificationState: r.verification.state,
      evidence: r.verification.evidence,
      detail: { result: r.data },
    });
    return decision.outcome === "monitor_only"
      ? { status: "monitor_only", result: r.data, verification: r.verification }
      : { status: "allow", result: r.data, verification: r.verification };
  } catch (e) {
    await appendJarvisAction({
      workspaceId: ctx.workspaceId,
      actorKind: "human",
      initiatedBy: ctx.principalId,
      capabilityId,
      decision: decision.outcome,
      executed: true,
      success: false,
      verificationState: "failed",
      error: e instanceof Error ? e.message : "execution_failed",
    });
    return { status: "error", reason: "execution_failed" };
  }
}
