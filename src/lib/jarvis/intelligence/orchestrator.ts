import "server-only";

import { isJarvisEnabled } from "@/lib/flags";
import { isJarvisIntelligenceEnabled } from "@/lib/flags";
import { resolveJarvisContext, type JarvisContext, type JarvisResolution } from "@/lib/jarvis/identity";
import { getIntelligenceLimits, type IntelligenceLimits } from "@/lib/jarvis/llm/limits";
import type { LLMProvider } from "@/lib/jarvis/llm/provider";
import { isLLMProviderError } from "@/lib/jarvis/llm/errors";
import {
  assembleAgencyContext,
  assembleClientContext,
  assembleUserContext,
} from "@/lib/jarvis/memory/context-engine";
import type { ContextPackage } from "@/lib/jarvis/memory/context-shape";

import { planContext as defaultPlanContext } from "./context-router";
import { buildSystemPrompt } from "./prompt";
import { parseAssistantResponse } from "./response-contract";
import { callProviderWithPolicy } from "./provider-call";
import { bridgeProposedIntent, type ActionBridgeDeps, type ActionBridgeResult } from "./action-bridge";
import { bridgeMemoryCandidate, type MemoryBridgeDeps, type MemoryBridgeResult } from "./memory-bridge";
import {
  createConversationRepo,
  SAFE_FAILURE_MESSAGE,
  type AssistantRow,
  type ConversationRepo,
  type ConversationThread,
} from "./repository";
import type {
  ContextPlan,
  TrustedProvenance,
  TurnResult,
  ValidatedProposedIntent,
  ValidatedMemoryCandidate,
} from "./types";

/**
 * Jarvis Intelligence — orchestrator (Slice C, server-only). THE trusted entry
 * boundary for one conversation turn. It enforces, in a LOCKED order:
 *
 *   1. flags (JARVIS_ENABLED + JARVIS_INTELLIGENCE_ENABLED) — fail closed;
 *   2. authenticate + authorize the human principal (never the model);
 *   3. validate input (reject empty / oversized BEFORE any persistence or call);
 *   4. resolve or create + verify ownership of the thread;
 *   5. persist the user message BEFORE calling the provider;
 *   6. deterministic context routing (the model never chooses its data);
 *   7. assemble bounded context + bounded history;
 *   8. build the trusted prompt and call the provider under an owned deadline;
 *   9. validate the UNTRUSTED model output;
 *  10. persist assistant success OR a safe failure; return a safe result.
 *
 * The LLM is NOT an authorization mechanism. It cannot execute, approve, widen
 * scope, choose workspace/user/client, or write memory. In Slice D, validated
 * proposals are bridged into the EXISTING F1 / Memory systems by trusted code;
 * the model gains no authority.
 *
 * Everything external is injectable for tests (no DB / network / keys needed).
 *
 * ── IDEMPOTENCY BOUNDARY (read before wiring a transport) ────────────────────
 * `request_id` is generated ONCE PER `runIntelligenceTurn` INVOCATION and is a
 * CORRELATION id only — it is NOT a transport idempotency key. Each call to this
 * function is a DISTINCT turn: it mints a new request_id, persists a new user
 * message, and (on success) runs the bridges exactly once. There is intentionally
 * NO cross-invocation dedup here — no check-then-insert, no process-memory cache,
 * and no source_ref lookup masquerading as idempotency.
 *
 * Therefore callers MUST NOT automatically retry `runIntelligenceTurn` after an
 * ambiguous transport/result failure once the operational bridges are active: a
 * retry is a NEW turn and may create a second F1 proposal / Memory candidate.
 *
 * RELEASE BLOCKER for the future retryable public transport (chat) slice — before
 * exposing any retryable transport, require a stable, trusted, transport-supplied
 * idempotency key threaded as:
 *   ACTION: transport key → F1 bridge → existing jarvis_proposals.idempotency_key
 *           (UNIQUE) with atomic get-or-create / conflict-safe semantics
 *           + jarvis_action_events correlation;
 *   MEMORY: transport key → an additive DB uniqueness mechanism with atomic
 *           create-or-get (this MAY justify a future migration — NOT in this slice).
 */

/** Slice-A DB CHECK bound on jarvis_messages.content (1..20000). */
const MAX_MESSAGE_CHARS = 20_000;

export interface TurnInput {
  /** Existing thread to continue, or omit to start a new one. */
  threadId?: string;
  /** The current user turn (raw; trimmed + bounded here). */
  message: string;
}

/** Context assembly seam (defaults to the real Context Engine). */
export interface ContextAssembler {
  agency(): Promise<ContextPackage>;
  user(userId: string): Promise<ContextPackage>;
  client(clientId: string): Promise<ContextPackage | null>;
}

export interface TurnDeps {
  /** The LLM provider — ALWAYS the mock in Slice C (no real provider exists). */
  provider: LLMProvider;
  /** Auth seam (defaults to the non-redirecting resolver). */
  resolveContext?: () => Promise<JarvisResolution>;
  /** Storage boundary seam. */
  repo?: ConversationRepo;
  /** Deterministic router seam. */
  router?: (ctx: JarvisContext, message: string, thread: { lastClientId: string | null }) => Promise<ContextPlan>;
  /** Context Engine seam. */
  assembler?: ContextAssembler;
  /** Central limits seam. */
  limits?: IntelligenceLimits;
  /** Server-generated request-id seam (deterministic in tests). */
  uuid?: () => string;
  /** Slice-D action-bridge seams (F1). */
  actionBridge?: ActionBridgeDeps;
  /** Slice-D memory-bridge seams (Memory). */
  memoryBridge?: MemoryBridgeDeps;
}

const defaultAssembler: ContextAssembler = {
  agency: assembleAgencyContext,
  user: assembleUserContext,
  client: assembleClientContext,
};

function countPortalFacts(pkgs: ContextPackage[]): number {
  return pkgs.reduce((sum, p) => sum + p.portal.sections.reduce((s, sec) => s + sec.facts.length, 0), 0);
}
function countMemory(pkgs: ContextPackage[]): number {
  return pkgs.reduce((sum, p) => sum + p.memory.length + p.openCommitments.length + p.unresolvedConflicts.length, 0);
}

/** Run one deterministic Intelligence turn. Never throws to the caller for an
 *  expected failure — returns a typed, safe {ok:false} instead. */
export async function runIntelligenceTurn(input: TurnInput, deps: TurnDeps): Promise<TurnResult> {
  // (1) Flags — fail closed. The LLM is never reachable unless BOTH are on.
  if (!isJarvisEnabled() || !isJarvisIntelligenceEnabled()) {
    return { ok: false, reason: "intelligence_disabled" };
  }

  // (2) Authenticate + authorize the human. Authority is the principal's, never
  //     the model's. resolveJarvisContext requires admin + workspace + jarvis.use.
  const resolve = deps.resolveContext ?? resolveJarvisContext;
  const resolution = await resolve();
  if ("denied" in resolution) {
    return { ok: false, reason: `not_authorized:${resolution.denied}` };
  }
  const ctx: JarvisContext = resolution;

  // (3) Validate input BEFORE any persistence or provider call.
  const message = (input.message ?? "").trim();
  if (message.length === 0) return { ok: false, reason: "empty_message" };
  if (message.length > MAX_MESSAGE_CHARS) return { ok: false, reason: "message_too_long" };

  const repo = deps.repo ?? createConversationRepo();
  const limits = deps.limits ?? getIntelligenceLimits();
  const newUuid = deps.uuid ?? (() => globalThis.crypto.randomUUID());
  const assembler = deps.assembler ?? defaultAssembler;
  const router = deps.router ?? defaultPlanContext;

  // Server-generated CORRELATION id for BOTH rows of this turn. Per-invocation,
  // NOT a transport idempotency key (see the IDEMPOTENCY BOUNDARY note above): two
  // independent invocations get two distinct request_ids and are two distinct turns.
  const requestId = newUuid();

  // (4) Resolve or create + verify ownership of the thread (trusted, owner-only).
  let thread: ConversationThread;
  if (input.threadId) {
    const loaded = await repo.loadAuthorizedThread(ctx, input.threadId);
    if (!loaded) return { ok: false, reason: "thread_not_found", requestId };
    thread = loaded;
  } else {
    thread = await repo.createThread(ctx);
  }

  // (5) LOCKED: persist the user message BEFORE contacting the provider. If this
  //     write fails, we make NO provider call and honestly report non-persistence.
  try {
    await repo.persistUserMessage(ctx, thread.id, message, requestId);
  } catch {
    return { ok: false, reason: "persist_failed", threadId: thread.id, requestId, persisted: false };
  }

  // (6) Deterministic context routing. The model never selects its own data, and
  //     a model-supplied client id would have zero authority here.
  const plan = await router(ctx, message, { lastClientId: thread.lastClientId });

  // Ambiguous / unresolved referent ⇒ ask, deterministically. No provider call,
  // no data leaked. Persist the clarification as an ok assistant turn.
  if (plan.kind === "ambiguous_client" || plan.kind === "unknown_client") {
    const clarification =
      plan.kind === "ambiguous_client"
        ? `I can help with that — which client do you mean: ${plan.candidates.map((c) => c.name).join(", ")}?`
        : "I couldn't confidently tell which client you mean. Which client should I look at?";
    // A clarification IS an assistant success turn — only claim ok if it stored.
    const stored = await tryPersistAssistant(repo, ctx, thread.id, requestId, {
      status: "ok",
      content: clarification,
      provenance: { contextKind: plan.kind, clarification: true },
    });
    if (!stored) return { ok: false, reason: "persist_failed", threadId: thread.id, requestId, persisted: false };
    return {
      ok: true,
      threadId: thread.id,
      requestId,
      assistantMessage: clarification,
      clarification: true,
      persisted: true,
    };
  }

  // (7) Assemble bounded context (via the Context Engine) + bounded history.
  let contexts: ContextPackage[];
  try {
    if (plan.kind === "client") {
      const pkg = await assembler.client(plan.clientId);
      if (!pkg) {
        // Router resolved an authorized client but assembly returned nothing —
        // do NOT answer as if context were complete. Safe failure.
        const stored = await persistFailure(repo, ctx, thread.id, requestId, "context_unavailable");
        return { ok: false, reason: "context_unavailable", threadId: thread.id, requestId, persisted: stored };
      }
      contexts = [pkg];
      // Update the deterministic thread referent ONLY after a successful resolve.
      await repo.updateLastClientId(ctx, thread.id, plan.clientId);
    } else if (plan.kind === "user") {
      contexts = [await assembler.user(ctx.principalId), await assembler.agency()];
    } else {
      contexts = [await assembler.agency()];
    }
  } catch {
    const stored = await persistFailure(repo, ctx, thread.id, requestId, "context_unavailable");
    return { ok: false, reason: "context_unavailable", threadId: thread.id, requestId, persisted: stored };
  }

  // Bounded history: last (historyTurns * 2) ok messages, chronological. Loaded
  // AFTER persisting the user message, so the current turn is included exactly
  // once (no duplication). Role + content only — no provenance/intents/system.
  const history = await repo.loadBoundedHistory(ctx, thread.id, limits.historyTurns * 2);

  // (8) Build the trusted prompt and call the provider under an owned deadline.
  const system = buildSystemPrompt(contexts);
  let resultText: string;
  let providerId: string;
  let model: string;
  let usage: unknown;
  try {
    const result = await callProviderWithPolicy(deps.provider, { system, messages: history }, limits);
    resultText = result.text;
    providerId = result.providerId; // TRUSTED adapter metadata, never model-claimed
    model = result.model;
    usage = result.usage;
  } catch (e) {
    const errorClass = isLLMProviderError(e) ? e.kind : "unavailable";
    const stored = await persistFailure(repo, ctx, thread.id, requestId, errorClass);
    return { ok: false, reason: errorClass, threadId: thread.id, requestId, persisted: stored };
  }

  // (9) Validate the UNTRUSTED model output. Malformed ⇒ safe failure; never
  //     persist the raw blob as assistant content.
  const parsed = parseAssistantResponse(resultText);
  if (!parsed.ok) {
    const stored = await persistFailure(repo, ctx, thread.id, requestId, `invalid_response:${parsed.reason}`);
    return { ok: false, reason: "invalid_response", threadId: thread.id, requestId, persisted: stored };
  }
  const value = parsed.value;

  // (10) Persist assistant success with TRUSTED provenance/metadata, then return.
  const provenance: TrustedProvenance = {
    contextKind: plan.kind,
    clientId: plan.kind === "client" ? plan.clientId : null,
    historyMessages: history.length,
    contextMemoryCount: countMemory(contexts),
    contextPortalFactCount: countPortalFacts(contexts),
  };

  // Durable persistence is a PRECONDITION of an ok:true result. If the write
  // throws, we do NOT tell the caller the turn succeeded.
  const stored = await tryPersistAssistant(repo, ctx, thread.id, requestId, {
    status: "ok",
    content: value.assistantMessage,
    reasoningSummary: value.reasoningSummary,
    uncertainty: value.uncertainty,
    // proposed_intent HAS a column (0067) — persist the VALIDATED (not executed)
    // proposal. memory_candidate has no column and is NOT written in Slice C;
    // it is returned to the caller only.
    proposedIntent: value.proposedIntent,
    provider: providerId,
    model,
    usage,
    provenance,
  });
  if (!stored) return { ok: false, reason: "persist_failed", threadId: thread.id, requestId, persisted: false };

  // (11) Slice-D BRIDGES. Only reached once the assistant row is durably stored,
  //      so we never create an operational side effect for a turn whose record
  //      failed to persist. The model's proposals are UNTRUSTED suggestions; the
  //      bridges gate them into the existing trusted F1 / Memory systems.
  const { action, memory } = await runBridges({
    turnCtx: ctx,
    resolve,
    proposedIntent: value.proposedIntent,
    memoryCandidate: value.memoryCandidate,
    plan,
    requestId,
    deps,
  });

  return {
    ok: true,
    threadId: thread.id,
    requestId,
    assistantMessage: value.assistantMessage,
    proposedIntent: value.proposedIntent,
    memoryCandidate: value.memoryCandidate,
    uncertainty: value.uncertainty,
    persisted: true,
    action,
    memory,
  };
}

/**
 * Run the Slice-D bridges with centralized REAUTHORIZATION (TOCTOU): re-resolve
 * the principal at bridge time and require it to match the turn's principal +
 * workspace. A denied/changed authorization means neither bridge runs. Each bridge
 * runs at most ONCE per turn, and a failure in one is isolated from the other and
 * from the (already durable) conversation.
 */
async function runBridges(args: {
  turnCtx: JarvisContext;
  resolve: () => Promise<JarvisResolution>;
  proposedIntent?: ValidatedProposedIntent;
  memoryCandidate?: ValidatedMemoryCandidate;
  plan: ContextPlan;
  requestId: string;
  deps: TurnDeps;
}): Promise<{ action?: ActionBridgeResult; memory?: MemoryBridgeResult }> {
  const { turnCtx, resolve, proposedIntent, memoryCandidate, plan, requestId, deps } = args;

  // Nothing proposed ⇒ no reauthorization, no bridge work.
  if (!proposedIntent && !memoryCandidate) {
    return { action: { status: "not_requested" }, memory: { status: "not_requested" } };
  }

  // Reauthorize ONCE at bridge time; both bridges share the fresh, checked context.
  let reauth: JarvisResolution;
  try {
    reauth = await resolve();
  } catch {
    reauth = { denied: "not_enabled" };
  }
  if ("denied" in reauth || reauth.principalId !== turnCtx.principalId || reauth.workspaceId !== turnCtx.workspaceId) {
    const reason = "denied" in reauth ? `reauth:${reauth.denied}` : "context_changed";
    return {
      action: proposedIntent ? { status: "unauthorized", reason } : { status: "not_requested" },
      memory: memoryCandidate ? { status: "unauthorized", reason } : { status: "not_requested" },
    };
  }
  const freshCtx: JarvisContext = reauth;

  let action: ActionBridgeResult;
  try {
    action = await bridgeProposedIntent({ ctx: freshCtx, intent: proposedIntent, plan }, deps.actionBridge);
  } catch {
    action = proposedIntent
      ? { status: "failed", capabilityId: proposedIntent.capabilityId, reason: "bridge_error" }
      : { status: "not_requested" };
  }

  let memory: MemoryBridgeResult;
  try {
    memory = await bridgeMemoryCandidate({ ctx: freshCtx, candidate: memoryCandidate, plan, requestId }, deps.memoryBridge);
  } catch {
    memory = { status: "failed", reason: "bridge_error" };
  }

  return { action, memory };
}

/** Attempt an assistant-row write; return whether it durably persisted. Never
 *  throws — callers use the boolean to report honest persistence status. */
async function tryPersistAssistant(
  repo: ConversationRepo,
  ctx: JarvisContext,
  threadId: string,
  requestId: string,
  row: AssistantRow
): Promise<boolean> {
  try {
    await repo.persistAssistant(ctx, threadId, requestId, row);
    return true;
  } catch {
    return false;
  }
}

/** Persist a SAFE failure row (generic copy; never raw response/stack/secret/
 *  prompt/context). Returns whether the row was durably stored. */
function persistFailure(
  repo: ConversationRepo,
  ctx: JarvisContext,
  threadId: string,
  requestId: string,
  errorClass: string
): Promise<boolean> {
  return tryPersistAssistant(repo, ctx, threadId, requestId, {
    status: "error",
    content: SAFE_FAILURE_MESSAGE,
    provenance: { errorClass },
  });
}
