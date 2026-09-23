import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/database.types";
import { appendMemoryEvent } from "./events";
import { decideIngestion } from "./ingestion";
import { currentOnCreate, decideTransition, type MemoryCreateState } from "./state-machine";
import { scanMemoryContent } from "./secrets";
import type { MemoryCategory, MemoryScope, MemorySourceKind } from "./types";

/**
 * Memory write path (server-only). Runs under the service role AFTER the server
 * action has authenticated the principal and checked capability grants. Every
 * mutation is deterministic (ingestion policy + state machine) and journalled to
 * the append-only lineage log. Corrections are ATOMIC via the SQL RPC.
 *
 * Portal remains authoritative: callers pass `assertsPortalOwnedValue` when a
 * candidate would duplicate operational truth, and the ingestion policy rejects.
 */
export interface MemoryActor {
  principalId: string;
  workspaceId: string;
  display: string;
  /** Holds jarvis.approve — required to confirm / supersede / retire. */
  hasApproveAuthority: boolean;
}

export interface MemoryCreateInput {
  scope: MemoryScope;
  category: MemoryCategory;
  claim: string;
  body?: string | null;
  structured?: Record<string, unknown>;
  clientId?: string | null;
  userId?: string | null;
  subjectKind?: string | null;
  subjectRef?: string | null;
  sourceKind: MemorySourceKind;
  sourceRef?: string | null;
  observedAt?: string | null;
  importance?: number;
  declaredSecret?: boolean;
  assertsPortalOwnedValue?: boolean;
}

export type MemoryWriteResult =
  | { ok: true; id: string; state: string; detail?: string }
  | { ok: false; reason: string; secretCategories?: string[] };

function scopeError(input: { scope: MemoryScope; clientId?: string | null; userId?: string | null }): string | null {
  if (input.scope === "agency" && (input.clientId || input.userId)) return "agency memory takes no client/user";
  if (input.scope === "client" && !input.clientId) return "client memory requires clientId";
  if (input.scope === "client" && input.userId) return "client memory takes no userId";
  if (input.scope === "user" && !input.userId) return "user memory requires userId";
  if (input.scope === "user" && input.clientId) return "user memory takes no clientId";
  return null;
}

/** Create a candidate memory. Ingestion policy decides observed/inferred/proposed or reject. */
export async function createMemory(actor: MemoryActor, input: MemoryCreateInput): Promise<MemoryWriteResult> {
  const scopeErr = scopeError(input);
  if (scopeErr) return { ok: false, reason: scopeErr };

  const decision = decideIngestion({
    category: input.category,
    sourceKind: input.sourceKind,
    claim: input.claim,
    body: input.body ?? null,
    structured: input.structured,
    declaredSecret: input.declaredSecret,
    supplierHasApproveAuthority: actor.hasApproveAuthority,
    assertsPortalOwnedValue: input.assertsPortalOwnedValue,
  });

  if (decision.decision === "reject") {
    // Record the rejection WITHOUT persisting any content (safe labels only).
    await appendMemoryEvent({
      workspaceId: actor.workspaceId,
      memoryId: null,
      eventType: "rejected",
      actorKind: "human",
      actorUserId: actor.principalId,
      actorDisplay: actor.display,
      reason: decision.reason,
      detail: decision.reason === "prohibited_secret" ? { secretCategories: decision.secretCategories ?? [] } : {},
    });
    return { ok: false, reason: decision.reason, secretCategories: decision.secretCategories };
  }

  const state: MemoryCreateState = decision.state;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("jarvis_memories")
    .insert({
      workspace_id: actor.workspaceId,
      scope: input.scope,
      client_id: input.clientId ?? null,
      user_id: input.userId ?? null,
      subject_kind: input.subjectKind ?? null,
      subject_ref: input.subjectRef ?? null,
      category: input.category,
      claim: input.claim.trim(),
      body: input.body ?? null,
      structured: (input.structured as unknown as Json) ?? {},
      state,
      current: currentOnCreate(state),
      importance: input.importance ?? 0,
      source_kind: input.sourceKind,
      source_ref: input.sourceRef ?? null,
      observed_at: input.observedAt ?? new Date().toISOString(),
      supplied_by: actor.principalId,
      supplied_display: actor.display,
      created_by: actor.principalId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, reason: "could_not_create_memory" };

  await appendMemoryEvent({
    workspaceId: actor.workspaceId,
    memoryId: data.id as string,
    eventType: "created",
    actorKind: "human",
    actorUserId: actor.principalId,
    actorDisplay: actor.display,
    reason: decision.reason,
    detail: { state, category: input.category, sourceKind: input.sourceKind },
  });
  return { ok: true, id: data.id as string, state };
}

async function loadState(workspaceId: string, memoryId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("jarvis_memories")
    .select("state")
    .eq("id", memoryId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return (data?.state as string | undefined) ?? null;
}

/** Confirm a proposed/inferred/observed memory → confirmed (requires authority). */
export async function confirmMemory(actor: MemoryActor, memoryId: string): Promise<MemoryWriteResult> {
  const from = await loadState(actor.workspaceId, memoryId);
  if (!from) return { ok: false, reason: "not_found" };
  const t = decideTransition({ from: from as never, transition: "confirm", hasApproveAuthority: actor.hasApproveAuthority });
  if (!t.ok) return { ok: false, reason: t.reason };

  const admin = createAdminClient();
  const { data } = await admin
    .from("jarvis_memories")
    .update({ state: "confirmed", current: true, confirmed_by: actor.principalId, confirmed_at: new Date().toISOString() })
    .eq("id", memoryId)
    .eq("workspace_id", actor.workspaceId)
    .eq("state", from as never) // single-use guard against a racing transition
    .select("id");
  if (!data || data.length === 0) return { ok: false, reason: "race_or_ineligible" };

  await appendMemoryEvent({
    workspaceId: actor.workspaceId,
    memoryId,
    eventType: "confirmed",
    actorKind: "human",
    actorUserId: actor.principalId,
    actorDisplay: actor.display,
    detail: { from },
  });
  return { ok: true, id: memoryId, state: "confirmed" };
}

/** Retire a memory → not returned by normal retrieval (requires authority). */
export async function retireMemory(actor: MemoryActor, memoryId: string, reason: string): Promise<MemoryWriteResult> {
  const from = await loadState(actor.workspaceId, memoryId);
  if (!from) return { ok: false, reason: "not_found" };
  const t = decideTransition({ from: from as never, transition: "retire", hasApproveAuthority: actor.hasApproveAuthority });
  if (!t.ok) return { ok: false, reason: t.reason };

  const admin = createAdminClient();
  const { data } = await admin
    .from("jarvis_memories")
    .update({ state: "retired", current: false, retired_at: new Date().toISOString(), retired_reason: reason.slice(0, 500) })
    .eq("id", memoryId)
    .eq("workspace_id", actor.workspaceId)
    .eq("state", from as never)
    .select("id");
  if (!data || data.length === 0) return { ok: false, reason: "race_or_ineligible" };

  await appendMemoryEvent({
    workspaceId: actor.workspaceId,
    memoryId,
    eventType: "retired",
    actorKind: "human",
    actorUserId: actor.principalId,
    actorDisplay: actor.display,
    reason: reason.slice(0, 500),
    detail: { from },
  });
  return { ok: true, id: memoryId, state: "retired" };
}

/**
 * Correct a memory by SUPERSEDING it: creates a new confirmed replacement and
 * marks the old superseded — ATOMICALLY via the SQL RPC. History is preserved.
 * Requires authority; secret content is rejected before any write.
 */
export async function supersedeMemory(
  actor: MemoryActor,
  oldId: string,
  newInput: MemoryCreateInput,
  reason: string
): Promise<MemoryWriteResult> {
  if (!actor.hasApproveAuthority) return { ok: false, reason: "requires_approval_authority" };
  const scopeErr = scopeError(newInput);
  if (scopeErr) return { ok: false, reason: scopeErr };

  const secret = scanMemoryContent({
    claim: newInput.claim,
    body: newInput.body ?? null,
    structured: newInput.structured,
    declaredSecret: newInput.declaredSecret,
  });
  if (secret.blocked) {
    await appendMemoryEvent({
      workspaceId: actor.workspaceId,
      memoryId: oldId,
      eventType: "rejected",
      actorKind: "human",
      actorUserId: actor.principalId,
      actorDisplay: actor.display,
      reason: "prohibited_secret",
      detail: { secretCategories: secret.categories },
    });
    return { ok: false, reason: "prohibited_secret", secretCategories: secret.categories };
  }

  const from = await loadState(actor.workspaceId, oldId);
  if (!from) return { ok: false, reason: "not_found" };
  const t = decideTransition({ from: from as never, transition: "supersede", hasApproveAuthority: actor.hasApproveAuthority });
  if (!t.ok) return { ok: false, reason: t.reason };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("jarvis_memory_supersede", {
    p_workspace: actor.workspaceId,
    p_old_id: oldId,
    p_new: {
      scope: newInput.scope,
      client_id: newInput.clientId ?? null,
      user_id: newInput.userId ?? null,
      subject_kind: newInput.subjectKind ?? null,
      subject_ref: newInput.subjectRef ?? null,
      category: newInput.category,
      claim: newInput.claim.trim(),
      body: newInput.body ?? null,
      structured: newInput.structured ?? {},
      source_kind: newInput.sourceKind,
      source_ref: newInput.sourceRef ?? null,
      observed_at: newInput.observedAt ?? null,
      importance: newInput.importance ?? 0,
    } as unknown as Json,
    p_actor: actor.principalId,
    p_actor_display: actor.display,
    p_reason: reason.slice(0, 500),
  });
  if (error || !data) return { ok: false, reason: "supersede_failed" };
  return { ok: true, id: data as string, state: "confirmed", detail: `superseded ${oldId}` };
}

/** Flag two memories as conflicting — both preserved, neither silently chosen. */
export async function flagConflict(
  actor: MemoryActor,
  aId: string,
  bId: string,
  reason: string
): Promise<MemoryWriteResult> {
  if (aId === bId) return { ok: false, reason: "cannot_conflict_with_self" };
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("jarvis_memories")
    .select("id")
    .eq("workspace_id", actor.workspaceId)
    .in("id", [aId, bId]);
  if (!rows || rows.length !== 2) return { ok: false, reason: "both_memories_required" };

  await admin.from("jarvis_memories").update({ conflicts_with_id: bId }).eq("id", aId).eq("workspace_id", actor.workspaceId);
  await admin.from("jarvis_memories").update({ conflicts_with_id: aId }).eq("id", bId).eq("workspace_id", actor.workspaceId);
  await appendMemoryEvent({
    workspaceId: actor.workspaceId,
    memoryId: aId,
    eventType: "conflict_flagged",
    actorKind: "human",
    actorUserId: actor.principalId,
    actorDisplay: actor.display,
    reason: reason.slice(0, 500),
    detail: { conflicts_with: bId },
  });
  await appendMemoryEvent({
    workspaceId: actor.workspaceId,
    memoryId: bId,
    eventType: "conflict_flagged",
    actorKind: "human",
    actorUserId: actor.principalId,
    actorDisplay: actor.display,
    reason: reason.slice(0, 500),
    detail: { conflicts_with: aId },
  });
  return { ok: true, id: aId, state: "conflict_flagged" };
}
