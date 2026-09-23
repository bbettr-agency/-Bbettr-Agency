import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActorKind, PolicyOutcome, RiskClass, VerificationState } from "./types";
import type { Json } from "@/lib/database.types";

/**
 * Append-only Jarvis action/audit log (Foundation 1). Writes go through the
 * service role (the table grants service_role INSERT+SELECT only; nobody may
 * UPDATE/DELETE). Reads are admin-only under RLS. `appendJarvisAction` THROWS on
 * failure — a mutation must never proceed unaudited, so callers audit the
 * decision BEFORE side effects and treat an audit failure as fail-closed.
 */
export interface JarvisActionInput {
  workspaceId: string;
  actorKind: ActorKind;
  initiatedBy?: string | null;
  isProactive?: boolean;
  capabilityId: string;
  decision: PolicyOutcome;
  riskClass?: RiskClass | null;
  targetClientId?: string | null;
  proposalId?: string | null;
  approvalBy?: string | null;
  executed?: boolean;
  success?: boolean | null;
  verificationState?: VerificationState | null;
  evidence?: unknown;
  sources?: unknown;
  idempotencyKey?: string | null;
  error?: string | null;
  detail?: unknown;
}

export async function appendJarvisAction(input: JarvisActionInput): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("jarvis_action_events").insert({
    workspace_id: input.workspaceId,
    actor_kind: input.actorKind,
    initiated_by: input.initiatedBy ?? null,
    is_proactive: input.isProactive ?? false,
    capability_id: input.capabilityId,
    decision: input.decision,
    risk_class: input.riskClass ?? null,
    target_client_id: input.targetClientId ?? null,
    proposal_id: input.proposalId ?? null,
    approval_by: input.approvalBy ?? null,
    executed: input.executed ?? false,
    success: input.success ?? null,
    verification_state: input.verificationState ?? null,
    evidence: (input.evidence as unknown as Json) ?? null,
    sources: (input.sources as unknown as Json) ?? null,
    idempotency_key: input.idempotencyKey ?? null,
    error: input.error ?? null,
    detail: (input.detail as unknown as Json) ?? null,
  });
  if (error) throw new Error(`jarvis audit append failed: ${error.message}`);
}

export interface JarvisActionRow {
  event_id: string;
  occurred_at: string;
  actor_kind: string;
  capability_id: string;
  decision: string;
  executed: boolean;
  success: boolean | null;
  verification_state: string | null;
  error: string | null;
}

/** Admin-only recent action log (RLS: admin + agency workspace). */
export async function readRecentJarvisActions(limit = 50): Promise<JarvisActionRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jarvis_action_events")
    .select("event_id, occurred_at, actor_kind, capability_id, decision, executed, success, verification_state, error")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as JarvisActionRow[];
}
