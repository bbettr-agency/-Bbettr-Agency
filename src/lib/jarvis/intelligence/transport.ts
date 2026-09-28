import { z } from "zod";
import type { DurableTurnOutcome } from "./orchestrator";
import type { TurnResult, ValidatedUncertainty } from "./types";
import type { ActionBridgeResult } from "./action-bridge";
import type { MemoryBridgeResult } from "./memory-bridge";

/**
 * Jarvis Intelligence — F1d TRANSPORT (pure). The public HTTP boundary's request
 * schema and the DurableTurnOutcome → bounded-DTO mapper. Deliberately dependency-
 * light (type-only imports of the orchestrator/result types) so it is unit-testable
 * without the server graph. It NEVER serializes an internal object blindly: every
 * response field is on an explicit allow-list. It maps failure classes to a stable,
 * bounded public taxonomy and never surfaces raw provider/DB/context/prompt/reasoning.
 */

// The transport idempotency key + threadId are UUIDs. Same permissive shape as the
// orchestrator's DURABLE_KEY_RE, so a key that passes here also passes F1b.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Max accepted message length — MUST match the orchestrator's MAX_MESSAGE_CHARS. */
export const MESSAGE_MAX_CHARS = 20_000;

/**
 * Strict request schema for POST /api/jarvis/chat. Unknown keys are REJECTED (a public
 * security boundary must not silently ignore smuggled fields like workspaceId/provider/
 * operationKey). `message` is trimmed and bounded to match F1b's request-hash input
 * (F1b trims again — idempotent). `threadId` omitted stays omitted (F1b hashes
 * `threadId ?? null`; the route must never inject a generated thread id on retry).
 */
export const chatRequestSchema = z
  .object({
    message: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().min(1, "empty_message").max(MESSAGE_MAX_CHARS, "message_too_long")),
    threadId: z.string().regex(UUID_RE, "invalid_thread_id").optional(),
    idempotencyKey: z.string().regex(UUID_RE, "invalid_idempotency_key"),
  })
  .strict();

export type ChatRequest = z.infer<typeof chatRequestSchema>;

// ── Public response DTOs (allow-list only) ───────────────────────────────────
export interface PublicActionOutcome {
  status: string;
  capabilityId?: string;
  proposalId?: string;
}
export interface PublicMemoryOutcome {
  status: string;
  memoryId?: string;
}
export interface PublicUncertainty {
  level: string;
  notes?: string;
}

export type JarvisChatBody =
  | {
      status: "completed";
      replay: boolean;
      requestId: string;
      threadId: string;
      assistantMessage: string;
      clarification?: true;
      uncertainty?: PublicUncertainty;
      action?: PublicActionOutcome;
      memory?: PublicMemoryOutcome;
    }
  | { status: "processing"; turnId: string }
  | { error: string; replay?: true; turnId?: string; requestId?: string };

export interface MappedResponse {
  status: number; // HTTP status
  body: JarvisChatBody;
}

// ── Bounded field projections (never expose raw result/args/state/reason blobs) ─
function projectUncertainty(u: ValidatedUncertainty | undefined): PublicUncertainty | undefined {
  if (!u) return undefined;
  return u.notes !== undefined ? { level: u.level, notes: u.notes } : { level: u.level };
}

function projectAction(a: ActionBridgeResult | undefined): PublicActionOutcome | undefined {
  if (!a) return undefined;
  const out: PublicActionOutcome = { status: a.status };
  // capabilityId exists on read_result/monitor_only/approval_required/failed variants.
  if ("capabilityId" in a && typeof a.capabilityId === "string") out.capabilityId = a.capabilityId;
  if (a.status === "approval_required") out.proposalId = a.proposalId;
  // Deliberately NOT exposed: read_result/monitor_only `result`, and bridge `reason`.
  return out;
}

function projectMemory(m: MemoryBridgeResult | undefined): PublicMemoryOutcome | undefined {
  if (!m) return undefined;
  const out: PublicMemoryOutcome = { status: m.status };
  if (m.status === "needs_confirmation") out.memoryId = m.memoryId;
  // Deliberately NOT exposed: `state`, `reason`, `secretCategories`.
  return out;
}

function projectSuccess(result: Extract<TurnResult, { ok: true }>, replay: boolean): JarvisChatBody {
  const body: Extract<JarvisChatBody, { status: "completed" }> = {
    status: "completed",
    replay,
    requestId: result.requestId,
    threadId: result.threadId,
    assistantMessage: result.assistantMessage,
  };
  if (result.clarification) body.clarification = true;
  const uncertainty = projectUncertainty(result.uncertainty);
  if (uncertainty) body.uncertainty = uncertainty;
  const action = projectAction(result.action);
  if (action) body.action = action;
  const memory = projectMemory(result.memory);
  if (memory) body.memory = memory;
  return body;
}

/**
 * LOCKED failure taxonomy — used for BOTH an initial durable failure and a same-key
 * failed_replay (F1b stores the specific bounded `failure_reason`, so both are
 * deterministic). Unknown/unmapped reasons collapse to 500 internal_error; the raw
 * reason is NEVER returned outside this allow-list.
 */
export function mapFailureReason(reason: string): { status: number; code: string } {
  switch (reason) {
    case "timeout":
      return { status: 504, code: "provider_timeout" };
    case "rate_limit":
      return { status: 429, code: "rate_limited" };
    case "unavailable":
    case "configuration":
      return { status: 503, code: "provider_unavailable" };
    case "provider_4xx":
    case "provider_5xx":
      return { status: 502, code: "provider_error" };
    case "invalid_response":
      return { status: 502, code: "provider_invalid_response" };
    case "context_unavailable":
      return { status: 503, code: "context_unavailable" };
    case "thread_not_found":
      return { status: 404, code: "thread_not_found" };
    case "provider_start_failed":
    case "persist_failed":
    case "result_too_large":
      return { status: 500, code: "internal_error" };
    default:
      return { status: 500, code: "internal_error" };
  }
}

/**
 * Map a trusted DurableTurnOutcome to a bounded HTTP status + public body. Pure.
 * `conflict` carries NO ids (no stored-request leak). `requestId` is emitted ONLY for
 * outcomes that actually carry it (executed / completed_replay); in_progress and the
 * failed/abandoned replays carry only the owner's `turnId`.
 */
export function mapOutcomeToResponse(outcome: DurableTurnOutcome): MappedResponse {
  switch (outcome.kind) {
    case "disabled":
      return { status: 404, body: { error: "not_found" } };
    case "not_authorized":
      return { status: 403, body: { error: "jarvis_unavailable" } };
    case "invalid_input":
      return { status: 400, body: { error: "invalid_request" } };
    case "conflict":
      return { status: 409, body: { error: "idempotency_conflict" } };
    case "in_progress":
      return { status: 202, body: { status: "processing", turnId: outcome.turnId } };
    case "abandoned_replay":
      return { status: 409, body: { error: "turn_abandoned", replay: true, turnId: outcome.turnId } };
    case "failed_replay": {
      const { status, code } = mapFailureReason(outcome.reason);
      return { status, body: { error: code, replay: true, turnId: outcome.turnId } };
    }
    case "completed_replay":
      return { status: 200, body: projectSuccess(outcome.result, true) };
    case "executed": {
      if (outcome.result.ok) return { status: 200, body: projectSuccess(outcome.result, false) };
      const { status, code } = mapFailureReason(outcome.result.reason);
      const body: Extract<JarvisChatBody, { error: string }> = { error: code };
      if (outcome.result.requestId) body.requestId = outcome.result.requestId;
      return { status, body };
    }
  }
}
