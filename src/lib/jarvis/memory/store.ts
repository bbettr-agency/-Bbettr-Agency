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
 * operation that mutates canonical state AND must record lineage runs as ONE
 * transaction via a tightly-scoped RPC (row + event succeed or fail together).
 * The pure ingestion policy + state machine decide legality here; the RPC
 * re-guards preconditions. No authorization lives in the RPCs.
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

function rowJson(input: MemoryCreateInput, state: string, current: boolean): Json {
  return {
    scope: input.scope,
    client_id: input.clientId ?? null,
    user_id: input.userId ?? null,
    subject_kind: input.subjectKind ?? null,
    subject_ref: input.subjectRef ?? null,
    category: input.category,
    claim: input.claim.trim(),
    body: input.body ?? null,
    structured: input.structured ?? {},
    state,
    current,
    importance: input.importance ?? 0,
    source_kind: input.sourceKind,
    source_ref: input.sourceRef ?? null,
    observed_at: input.observedAt ?? null,
  } as unknown as Json;
}

/** Create a candidate memory (atomic row + 'created' event via RPC). */
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
    // No canonical row is created — only a single-table 'rejected' event (safe
    // labels only). Nothing to desync.
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
  const { data, error } = await admin.rpc("jarvis_memory_create", {
    p_workspace: actor.workspaceId,
    p_row: rowJson(input, state, currentOnCreate(state)),
    p_actor: actor.principalId,
    p_actor_display: actor.display,
    p_reason: decision.reason,
  });
  if (error || !data) return { ok: false, reason: "could_not_create_memory" };
  return { ok: true, id: data as string, state };
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

/** Confirm a proposed/inferred/observed memory → confirmed (atomic via RPC). */
export async function confirmMemory(actor: MemoryActor, memoryId: string): Promise<MemoryWriteResult> {
  const from = await loadState(actor.workspaceId, memoryId);
  if (!from) return { ok: false, reason: "not_found" };
  const t = decideTransition({ from: from as never, transition: "confirm", hasApproveAuthority: actor.hasApproveAuthority });
  if (!t.ok) return { ok: false, reason: t.reason };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("jarvis_memory_confirm", {
    p_workspace: actor.workspaceId,
    p_id: memoryId,
    p_from: from,
    p_actor: actor.principalId,
    p_actor_display: actor.display,
  });
  if (error) return { ok: false, reason: "confirm_failed" };
  if (data !== true) return { ok: false, reason: "race_or_ineligible" };
  return { ok: true, id: memoryId, state: "confirmed" };
}

/** Retire a memory → not returned by normal retrieval (atomic via RPC). */
export async function retireMemory(actor: MemoryActor, memoryId: string, reason: string): Promise<MemoryWriteResult> {
  const from = await loadState(actor.workspaceId, memoryId);
  if (!from) return { ok: false, reason: "not_found" };
  const t = decideTransition({ from: from as never, transition: "retire", hasApproveAuthority: actor.hasApproveAuthority });
  if (!t.ok) return { ok: false, reason: t.reason };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("jarvis_memory_retire", {
    p_workspace: actor.workspaceId,
    p_id: memoryId,
    p_from: from,
    p_reason: reason.slice(0, 500),
    p_actor: actor.principalId,
    p_actor_display: actor.display,
  });
  if (error) return { ok: false, reason: "retire_failed" };
  if (data !== true) return { ok: false, reason: "race_or_ineligible" };
  return { ok: true, id: memoryId, state: "retired" };
}

/**
 * Correct a memory by SUPERSEDING it: new confirmed replacement + old superseded,
 * ATOMICALLY via RPC. History preserved. Requires authority; secrets rejected
 * before any write.
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
    p_new: rowJson(newInput, "confirmed", true),
    p_actor: actor.principalId,
    p_actor_display: actor.display,
    p_reason: reason.slice(0, 500),
  });
  if (error || !data) return { ok: false, reason: "supersede_failed" };
  return { ok: true, id: data as string, state: "confirmed", detail: `superseded ${oldId}` };
}

/** Flag two memories as conflicting (atomic edges + events via RPC). Many-to-many. */
export async function flagConflict(
  actor: MemoryActor,
  aId: string,
  bId: string,
  reason: string
): Promise<MemoryWriteResult> {
  if (aId === bId) return { ok: false, reason: "cannot_conflict_with_self" };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("jarvis_memory_flag_conflict", {
    p_workspace: actor.workspaceId,
    p_a: aId,
    p_b: bId,
    p_actor: actor.principalId,
    p_actor_display: actor.display,
    p_reason: reason.slice(0, 500),
  });
  if (error || data !== true) return { ok: false, reason: "both_memories_required" };
  return { ok: true, id: aId, state: "conflict_flagged" };
}
