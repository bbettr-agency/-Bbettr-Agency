import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json, Database } from "@/lib/database.types";

type TurnsUpdate = Database["public"]["Tables"]["jarvis_turns"]["Update"];
import type { JarvisContext } from "@/lib/jarvis/identity";
import { MEMORY_CATEGORIES } from "@/lib/jarvis/memory/types";
import type { TurnResult, ValidatedAssistantResponse } from "./types";
import type { ActionBridgeResult } from "./action-bridge";
import type { MemoryBridgeResult } from "./memory-bridge";

/**
 * Jarvis Intelligence — DURABLE TURN LEDGER (Slice F1b, server-only).
 *
 * Transport-replay safety on top of the released 0068 `jarvis_turns` table. A
 * logical turn is CLAIMED atomically (the DB unique constraint arbitrates), then
 * checkpointed with strict set-once linkage, and finally COMPLETED with a bounded,
 * versioned, validated replay snapshot. A same-key retry REPLAYS the durable turn
 * and NEVER starts a second provider sequence.
 *
 * SCOPE (F1b): transport replay safety ONLY. This is NOT workflow recovery/
 * resumption and NOT model re-execution. A crash after the provider call but before
 * completion leaves the turn `processing` and NON-RESUMABLE — a replay returns
 * IN_PROGRESS and never re-runs the provider or the bridges. Downstream operation
 * idempotency (F1 proposals / Memory) is wired later in F1c; F1b therefore does NOT
 * provide complete cross-request side-effect idempotency (a durable side effect may
 * exist while the turn is still `processing`). This is intentional and documented.
 */

// ── Request hash: deterministic SHA-256 over the ORIGINAL transport envelope ──
export interface RequestEnvelope {
  workspaceId: string;
  userId: string;
  /** The ORIGINAL request's threadId, or null. A thread later created for a
   *  null-thread request must NEVER replace this null in the identity. */
  threadId: string | null;
  /** The exact accepted message string (no per-side normalization). */
  message: string;
}

/** Lowercase SHA-256 hex of the canonical fixed-order envelope. Matches the 0068
 *  `request_hash ~ '^[0-9a-f]{64}$'` CHECK. */
export function computeRequestHash(env: RequestEnvelope): string {
  // Fixed key order — do NOT hash arbitrary object ordering.
  const canonical = JSON.stringify({
    v: 1,
    workspaceId: env.workspaceId,
    userId: env.userId,
    threadId: env.threadId ?? null,
    message: env.message,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ── Versioned final replay snapshot ──────────────────────────────────────────
export const RESULT_SNAPSHOT_VERSION = 1 as const;
/** Application ceiling, below the DB hard backstop octet_length(result::text) <= 32768. */
export const RESULT_MAX_BYTES = 30_000;

export interface TurnResultSnapshot {
  v: 1;
  clarification?: true;
  assistantMessage: string;
  uncertainty?: ValidatedAssistantResponse["uncertainty"];
  proposedIntent?: ValidatedAssistantResponse["proposedIntent"];
  memoryCandidate?: ValidatedAssistantResponse["memoryCandidate"];
  action?: ActionBridgeResult;
  memory?: MemoryBridgeResult;
  provider?: string;
  model?: string;
  usage?: unknown;
  /** Set when the snapshot was reduced to fit the byte ceiling. */
  truncated?: true;
}

/** Trusted provider metadata captured at execution time (never model-claimed). */
export interface ProviderMeta {
  provider: string;
  model: string;
  usage: unknown;
}

/** Exact UTF-8 byte length of the serialized snapshot (NOT string.length). */
function byteLen(s: string): number {
  return Buffer.byteLength(s, "utf8");
}
/** Truncate a string to at most `maxBytes` UTF-8 bytes without splitting a codepoint. */
function byteTruncate(s: string, maxBytes: number): string {
  if (byteLen(s) <= maxBytes) return s;
  let out = "";
  let used = 0;
  for (const ch of s) {
    const b = byteLen(ch);
    if (used + b > maxBytes) break;
    out += ch;
    used += b;
  }
  return out;
}

const snapshotZod = z
  .object({
    v: z.literal(1),
    clarification: z.literal(true).optional(),
    assistantMessage: z.string().min(1),
    uncertainty: z.object({ level: z.enum(["low", "medium", "high"]), notes: z.string().optional() }).strict().optional(),
    proposedIntent: z
      .object({ capabilityId: z.string().min(1), args: z.record(z.string(), z.unknown()), rationale: z.string().optional() })
      .strict()
      .optional(),
    memoryCandidate: z
      .object({
        scope: z.enum(["agency", "client", "user"]),
        category: z.enum(MEMORY_CATEGORIES as unknown as [string, ...string[]]),
        claim: z.string().min(1),
        body: z.string().optional(),
      })
      .strict()
      .optional(),
    action: z.object({ status: z.string() }).passthrough().optional(),
    memory: z.object({ status: z.string() }).passthrough().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    usage: z.unknown().optional(),
    truncated: z.literal(true).optional(),
  })
  .strict();

/** Build the final replay snapshot from a SUCCESSFUL turn result + trusted provider
 *  metadata. Only trusted, bounded fields — never prompt/context/provider body/keys/
 *  hidden reasoning. reasoning_summary is deliberately NOT stored (not needed to
 *  reproduce the public TurnResult). Reduces to fit RESULT_MAX_BYTES if necessary. */
export function buildResultSnapshot(result: Extract<TurnResult, { ok: true }>, meta?: ProviderMeta): TurnResultSnapshot {
  const full: TurnResultSnapshot = {
    v: 1,
    ...(result.clarification ? { clarification: true as const } : {}),
    assistantMessage: result.assistantMessage,
    ...(result.uncertainty ? { uncertainty: result.uncertainty } : {}),
    ...(result.proposedIntent ? { proposedIntent: result.proposedIntent } : {}),
    ...(result.memoryCandidate ? { memoryCandidate: result.memoryCandidate } : {}),
    ...(result.action ? { action: result.action } : {}),
    ...(result.memory ? { memory: result.memory } : {}),
    ...(meta ? { provider: meta.provider, model: meta.model, usage: meta.usage } : {}),
  };
  if (byteLen(JSON.stringify(full)) <= RESULT_MAX_BYTES) return full;

  // Reduce: keep the trusted outcomes + a byte-bounded assistant message; drop the
  // largest model-authored/free fields. Mark truncated so replay is honest.
  const reduced: TurnResultSnapshot = {
    v: 1,
    ...(result.clarification ? { clarification: true as const } : {}),
    assistantMessage: byteTruncate(result.assistantMessage, 4_000),
    ...(result.uncertainty ? { uncertainty: { level: result.uncertainty.level } } : {}),
    ...(result.proposedIntent ? { proposedIntent: { capabilityId: result.proposedIntent.capabilityId, args: {} } } : {}),
    ...(result.action ? { action: result.action } : {}),
    ...(result.memory ? { memory: result.memory } : {}),
    ...(meta ? { provider: meta.provider, model: meta.model, usage: meta.usage } : {}),
    truncated: true,
  };
  // Guarantee fit even in pathological cases by shrinking the assistant message.
  let budget = 3_000;
  while (byteLen(JSON.stringify(reduced)) > RESULT_MAX_BYTES && budget > 0) {
    reduced.assistantMessage = byteTruncate(reduced.assistantMessage, budget);
    budget -= 500;
  }
  return reduced;
}

export type SnapshotParse = { ok: true; value: TurnResultSnapshot } | { ok: false; reason: "too_large" | "invalid" };

/** Validate a snapshot before persistence AND on replay. Never trusts DB JSON. */
export function validateResultSnapshot(raw: unknown): SnapshotParse {
  const parsed = snapshotZod.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  if (byteLen(JSON.stringify(parsed.data)) > RESULT_MAX_BYTES) return { ok: false, reason: "too_large" };
  return { ok: true, value: parsed.data as TurnResultSnapshot };
}

// ── Turn rows + typed durable outcomes ───────────────────────────────────────
export type TurnStatus = "processing" | "completed" | "failed" | "abandoned";

export interface TurnRow {
  id: string;
  workspace_id: string;
  user_id: string;
  thread_id: string | null;
  idempotency_key: string;
  request_hash: string;
  correlation_id: string;
  status: TurnStatus;
  provider_started_at: string | null;
  user_message_id: string | null;
  assistant_message_id: string | null;
  proposal_id: string | null;
  memory_id: string | null;
  result: unknown;
  failure_reason: string | null;
}

export type ClaimResult = { outcome: "claimed"; turn: TurnRow } | { outcome: "existing"; turn: TurnRow };

export interface ClaimInput {
  ctx: JarvisContext; // trusted workspace + principal (never model-supplied)
  idempotencyKey: string;
  requestHash: string;
  correlationId: string;
  leaseExpiresAt: string; // ISO
}

/** Raised on a set-once invariant violation (the 0068 BB68S trigger). */
export class TurnLinkageError extends Error {
  constructor(readonly column: string) {
    super(`jarvis_turns: ${column} is set-once`);
    this.name = "TurnLinkageError";
  }
}

export interface ConversationTurnRepo {
  claim(input: ClaimInput): Promise<ClaimResult>;
  setThreadId(turnId: string, threadId: string): Promise<void>;
  setUserMessageId(turnId: string, messageId: string): Promise<void>;
  markProviderStarted(turnId: string, at: string): Promise<void>;
  setAssistantMessageId(turnId: string, messageId: string): Promise<void>;
  setProposalId(turnId: string, proposalId: string): Promise<void>;
  setMemoryId(turnId: string, memoryId: string): Promise<void>;
  complete(turnId: string, result: TurnResultSnapshot): Promise<void>;
  fail(turnId: string, reason: string): Promise<void>;
}

const asRow = (d: Record<string, unknown>): TurnRow => ({
  id: d.id as string,
  workspace_id: d.workspace_id as string,
  user_id: d.user_id as string,
  thread_id: (d.thread_id as string | null) ?? null,
  idempotency_key: d.idempotency_key as string,
  request_hash: d.request_hash as string,
  correlation_id: d.correlation_id as string,
  status: d.status as TurnStatus,
  provider_started_at: (d.provider_started_at as string | null) ?? null,
  user_message_id: (d.user_message_id as string | null) ?? null,
  assistant_message_id: (d.assistant_message_id as string | null) ?? null,
  proposal_id: (d.proposal_id as string | null) ?? null,
  memory_id: (d.memory_id as string | null) ?? null,
  result: d.result ?? null,
  failure_reason: (d.failure_reason as string | null) ?? null,
});

const isSetOnceViolation = (e: unknown): boolean =>
  typeof (e as { code?: unknown })?.code === "string" && ((e as { code: string }).code === "BB68S" || (e as { code: string }).code === "BB68T");

export function createConversationTurnRepo(): ConversationTurnRepo {
  const link = async (turnId: string, column: string, value: string) => {
    const admin = createAdminClient();
    const { error } = await admin.from("jarvis_turns").update({ [column]: value } as TurnsUpdate).eq("id", turnId);
    if (error) {
      if (isSetOnceViolation(error)) throw new TurnLinkageError(column);
      throw new Error(`jarvis_turns: could not set ${column}`);
    }
  };
  return {
    async claim(input) {
      const admin = createAdminClient();
      const row = {
        workspace_id: input.ctx.workspaceId,
        user_id: input.ctx.principalId,
        idempotency_key: input.idempotencyKey,
        request_hash: input.requestHash,
        correlation_id: input.correlationId,
        lease_expires_at: input.leaseExpiresAt,
      };
      // INSERT ... ON CONFLICT DO NOTHING RETURNING (the unique constraint arbitrates).
      const { data: inserted, error } = await admin
        .from("jarvis_turns")
        .upsert(row, { onConflict: "workspace_id,user_id,idempotency_key", ignoreDuplicates: true })
        .select("*");
      if (error) throw new Error("jarvis_turns: claim failed");
      if (inserted && inserted.length === 1) return { outcome: "claimed", turn: asRow(inserted[0] as Record<string, unknown>) };
      // Lost the race / already exists → read the existing owner row by the full key tuple.
      const { data: existing, error: selErr } = await admin
        .from("jarvis_turns")
        .select("*")
        .eq("workspace_id", input.ctx.workspaceId)
        .eq("user_id", input.ctx.principalId)
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (selErr || !existing) throw new Error("jarvis_turns: claim conflict but no existing row");
      return { outcome: "existing", turn: asRow(existing as Record<string, unknown>) };
    },
    setThreadId: (t, v) => link(t, "thread_id", v),
    setUserMessageId: (t, v) => link(t, "user_message_id", v),
    markProviderStarted: (t, at) => link(t, "provider_started_at", at),
    setAssistantMessageId: (t, v) => link(t, "assistant_message_id", v),
    setProposalId: (t, v) => link(t, "proposal_id", v),
    setMemoryId: (t, v) => link(t, "memory_id", v),
    async complete(turnId, result) {
      const admin = createAdminClient();
      const { error } = await admin
        .from("jarvis_turns")
        .update({ status: "completed", result: result as unknown as Json, completed_at: new Date().toISOString() })
        .eq("id", turnId);
      if (error) throw new Error("jarvis_turns: could not complete turn");
    },
    async fail(turnId, reason) {
      const admin = createAdminClient();
      const safe = (reason || "failed").slice(0, 200) || "failed";
      const { error } = await admin.from("jarvis_turns").update({ status: "failed", failure_reason: safe }).eq("id", turnId);
      if (error) throw new Error("jarvis_turns: could not fail turn");
    },
  };
}

// ── Replay classification (pure) ─────────────────────────────────────────────
export type ReplayClassification =
  | { kind: "conflict" }
  | { kind: "completed_replay"; result: Extract<TurnResult, { ok: true }> }
  | { kind: "in_progress"; turnId: string }
  | { kind: "failed_replay"; turnId: string; reason: string }
  | { kind: "abandoned_replay"; turnId: string; reason: string }
  | { kind: "corrupt"; turnId: string };

/**
 * Classify an EXISTING turn against the incoming request hash. A hash mismatch is a
 * deterministic conflict and leaks NO data from the stored (different) request.
 */
export function classifyExisting(turn: TurnRow, requestHash: string): ReplayClassification {
  if (turn.request_hash !== requestHash) return { kind: "conflict" };
  switch (turn.status) {
    case "completed": {
      const parsed = validateResultSnapshot(turn.result);
      if (!parsed.ok) return { kind: "corrupt", turnId: turn.id }; // never trust DB JSON blindly
      return { kind: "completed_replay", result: snapshotToResult(parsed.value, turn) };
    }
    case "processing":
      return { kind: "in_progress", turnId: turn.id };
    case "failed":
      return { kind: "failed_replay", turnId: turn.id, reason: turn.failure_reason ?? "failed" };
    case "abandoned":
      return { kind: "abandoned_replay", turnId: turn.id, reason: turn.failure_reason ?? "abandoned" };
    default:
      return { kind: "corrupt", turnId: turn.id };
  }
}

/** Reconstruct the public ok:true TurnResult from a validated snapshot + turn row. */
export function snapshotToResult(s: TurnResultSnapshot, turn: TurnRow): Extract<TurnResult, { ok: true }> {
  return {
    ok: true,
    threadId: turn.thread_id ?? "",
    requestId: turn.correlation_id,
    assistantMessage: s.assistantMessage,
    proposedIntent: s.proposedIntent,
    memoryCandidate: s.memoryCandidate,
    uncertainty: s.uncertainty,
    ...(s.clarification ? { clarification: true as const } : {}),
    persisted: true,
    action: s.action,
    memory: s.memory,
  };
}
