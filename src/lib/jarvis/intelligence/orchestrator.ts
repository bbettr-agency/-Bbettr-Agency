import "server-only";

import { isJarvisEnabled } from "@/lib/flags";
import { isJarvisIntelligenceEnabled } from "@/lib/flags";
import { isJarvisRetrievalV2Enabled } from "@/lib/flags";
import { runRetrievalV2Turn } from "@/lib/jarvis/retrieval/pipeline";
import { fitHistory } from "@/lib/jarvis/retrieval/evidence/budget";
import { estimateTokens } from "@/lib/jarvis/retrieval/evidence/serialize";
import type { RetrievalTrace } from "@/lib/jarvis/retrieval/types";
import { resolveJarvisContext, type JarvisContext, type JarvisResolution, type JarvisApiDenial } from "@/lib/jarvis/identity";
import { getIntelligenceLimits, INTELLIGENCE_LIMIT_BOUNDS, type IntelligenceLimits } from "@/lib/jarvis/llm/limits";
import type { LLMProvider } from "@/lib/jarvis/llm/provider";
import { isLLMProviderError } from "@/lib/jarvis/llm/errors";
import {
  assembleAgencyContext,
  assembleClientContext,
  assembleUserContext,
} from "@/lib/jarvis/memory/context-engine";
import type { ContextPackage } from "@/lib/jarvis/memory/context-shape";

import { planContext as defaultPlanContext } from "./context-router";
import { buildSystemPrompt, buildSystemPromptFromData } from "./prompt";
import { redactIfSecret } from "@/lib/jarvis/memory/secrets";
import { parseAssistantResponse, ASSISTANT_RESPONSE_SCHEMA } from "./response-contract";
import { callProviderWithPolicy } from "./provider-call";
import { bridgeProposedIntent, type ActionBridgeDeps, type ActionBridgeResult } from "./action-bridge";
import { bridgeMemoryCandidate, type MemoryBridgeDeps, type MemoryBridgeResult } from "./memory-bridge";
import {
  createConversationTurnRepo,
  computeRequestHash,
  buildResultSnapshot,
  validateResultSnapshot,
  classifyExisting,
  type ConversationTurnRepo,
  type ProviderMeta,
} from "./turns";
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
  ValidatedUncertainty,
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

/** Retrieval V2 gives the model a modestly higher output-token allowance so a
 *  COMPLETE response object fits (the V2 client overview is richer than V1's
 *  context). Scoped to the V2 path only and still inside the hard clamp — V1 is
 *  unchanged. A higher env override (JARVIS_LLM_MAX_OUTPUT_TOKENS) is respected. */
const V2_MIN_OUTPUT_TOKENS = 2000;

export interface TurnInput {
  /** Existing thread to continue, or omit to start a new one. */
  threadId?: string;
  /** The current user turn (raw; trimmed + bounded here). */
  message: string;
  /**
   * TRANSPORT-INTERNAL COMPATIBILITY ONLY. Present so the durable path
   * (`runDurableTurn`) can share `TurnInput`. The KEYLESS `runIntelligenceTurn`
   * is the LEGACY/internal path and is NOT the intended public Intelligence
   * transport contract — F1d MUST require a trusted transport idempotency key via
   * `runDurableTurn`. Do not add new callers of the keyless path.
   */
  idempotencyKey?: string;
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
  /** Auth seam (defaults to the non-redirecting resolver). Used for preflight and as
   *  the stable request-time context source for the durable turn. */
  resolveContext?: () => Promise<JarvisResolution>;
  /**
   * DEDICATED BRIDGE-TIME reauthorization seam (R2 / F-02). Invoked AFRESH immediately
   * before the action/memory bridges cross into F1 capability invocation / proposal
   * creation / auto-read execution, so authorization reflects CURRENT server-side state
   * (grants/role/workspace can change after request entry). It must perform a genuinely
   * fresh, trusted, DB-backed resolve — NOT return a captured snapshot. Falls back to
   * `resolveContext`, then the default resolver, for existing internal/test callers.
   * Typed to the API resolver's richer denial union; a `JarvisResolution` resolver is a
   * subtype and remains assignable. A denial/throw/identity-change here fails closed.
   */
  reauthorize?: () => Promise<JarvisContext | JarvisApiDenial>;
  /** Storage boundary seam. */
  repo?: ConversationRepo;
  /** Deterministic router seam (Retrieval V1). */
  router?: (ctx: JarvisContext, message: string, thread: { lastClientId: string | null }) => Promise<ContextPlan>;
  /** Retrieval V2 seam (Client Intelligence). Defaults to the real pipeline when the
   *  JARVIS_RETRIEVAL_V2 flag is on. Returns a ContextPlan + a pre-serialized DATA
   *  block (null for clarify/unresolved) + a safe trace. Injectable for tests. */
  runRetrieval?: (
    ctx: JarvisContext,
    message: string,
    thread: { lastClientId: string | null }
  ) => Promise<{
    plan: ContextPlan;
    dataBlock: string | null;
    trace: RetrievalTrace;
    /** Deterministic, app-owned answer confidence (never model-generated). Optional on
     *  the seam type for test ergonomics; the real pipeline always supplies it. */
    confidence?: "high" | "qualified" | null;
    confidenceBasis?: string | null;
  }>;
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
  /** F1b durable turn ledger seam (defaults to the real jarvis_turns repo). */
  turnRepo?: ConversationTurnRepo;
  /** Injectable clock (ms) for the lease, deterministic in tests. */
  now?: () => number;
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

/** Shared gate: flags → auth → input bounds. No side effects, no persistence. */
type Preflight =
  | { ok: true; ctx: JarvisContext; message: string }
  | { ok: false; kind: "disabled" }
  | { ok: false; kind: "not_authorized"; reason: string }
  | { ok: false; kind: "invalid_input"; reason: "empty_message" | "message_too_long" };

async function preflight(input: TurnInput, deps: TurnDeps): Promise<Preflight> {
  if (!isJarvisEnabled() || !isJarvisIntelligenceEnabled()) return { ok: false, kind: "disabled" };
  const resolve = deps.resolveContext ?? resolveJarvisContext;
  const resolution = await resolve();
  if ("denied" in resolution) return { ok: false, kind: "not_authorized", reason: resolution.denied };
  const message = (input.message ?? "").trim();
  if (message.length === 0) return { ok: false, kind: "invalid_input", reason: "empty_message" };
  if (message.length > MAX_MESSAGE_CHARS) return { ok: false, kind: "invalid_input", reason: "message_too_long" };
  return { ok: true, ctx: resolution, message };
}

/**
 * LEGACY / internal keyless path — behavior unchanged. NOT the intended public
 * transport contract (that is `runDurableTurn`, which requires a trusted
 * idempotency key). Do not add new callers of this keyless path.
 */
export async function runIntelligenceTurn(input: TurnInput, deps: TurnDeps): Promise<TurnResult> {
  const pre = await preflight(input, deps);
  if (!pre.ok) {
    if (pre.kind === "disabled") return { ok: false, reason: "intelligence_disabled" };
    if (pre.kind === "not_authorized") return { ok: false, reason: `not_authorized:${pre.reason}` };
    return { ok: false, reason: pre.reason };
  }
  const requestId = (deps.uuid ?? (() => globalThis.crypto.randomUUID()))();
  return executeLifecycle({ ctx: pre.ctx, message: pre.message, input, deps, requestId });
}

/**
 * Optional set-once checkpoint hooks. The legacy path passes none (identical
 * behavior); the durable path (F1b) supplies them to record jarvis_turns linkage.
 * All hooks are BEST-EFFORT (audit/evidence) — a hook failure never aborts the turn;
 * the replay-safety guarantee rests on the claim + status + result snapshot, not on
 * these linkage writes.
 */
export interface TurnHooks {
  onThread?(threadId: string): Promise<void> | void;
  onUserMessage?(messageId: string): Promise<void> | void;
  beforeProvider?(): Promise<void> | void;
  onProviderResult?(meta: ProviderMeta): Promise<void> | void;
  onAssistant?(messageId: string): Promise<void> | void;
}
async function runHook(fn: (() => Promise<void> | void) | undefined): Promise<void> {
  if (!fn) return;
  try {
    await fn();
  } catch {
    /* best-effort checkpoint; never abort or fail the turn on a linkage write */
  }
}

/**
 * The full turn lifecycle (steps 4–11). Shared by the legacy and durable paths; the
 * durable path supplies `hooks` to checkpoint the jarvis_turns ledger. Never throws
 * for an expected failure — returns a typed, safe {ok:false}.
 */
async function executeLifecycle(params: {
  ctx: JarvisContext;
  message: string;
  input: TurnInput;
  deps: TurnDeps;
  requestId: string;
  hooks?: TurnHooks;
  /** Durable jarvis_turns.id (F1c). Present only on the durable path; the sole trusted
   *  source of the per-slot operation keys. Absent ⇒ legacy path derives no keys. */
  turnId?: string;
}): Promise<TurnResult> {
  const { ctx, message, input, deps, requestId, hooks, turnId } = params;
  // Bridge-time reauthorization (R2 / F-02): prefer the dedicated fresh resolver, then
  // the request-time context seam, then the default. This is used ONLY for the bridge
  // boundary — preflight/claim keep using the stable request-time context.
  const reauthorize = deps.reauthorize ?? deps.resolveContext ?? resolveJarvisContext;
  const repo = deps.repo ?? createConversationRepo();
  const limits = deps.limits ?? getIntelligenceLimits();
  const assembler = deps.assembler ?? defaultAssembler;
  const router = deps.router ?? defaultPlanContext;

  // (4) Resolve or create + verify ownership of the thread (trusted, owner-only).
  let thread: ConversationThread;
  if (input.threadId) {
    const loaded = await repo.loadAuthorizedThread(ctx, input.threadId);
    if (!loaded) return { ok: false, reason: "thread_not_found", requestId };
    thread = loaded;
  } else {
    thread = await repo.createThread(ctx);
  }
  await runHook(hooks?.onThread ? () => hooks.onThread!(thread.id) : undefined);

  // (5) LOCKED: persist the user message BEFORE contacting the provider. If this
  //     write fails, we make NO provider call and honestly report non-persistence.
  let userMessageId: string;
  try {
    userMessageId = await repo.persistUserMessage(ctx, thread.id, message, requestId);
  } catch {
    return { ok: false, reason: "persist_failed", threadId: thread.id, requestId, persisted: false };
  }
  await runHook(hooks?.onUserMessage ? () => hooks.onUserMessage!(userMessageId) : undefined);

  // (6) Deterministic context routing. The model never selects its own data, and
  //     a model-supplied client id would have zero authority here. Retrieval V2
  //     (Client Intelligence) is used when enabled; otherwise the original router.
  let plan: ContextPlan;
  let v2DataBlock: string | null = null;
  let v2Trace: RetrievalTrace | undefined;
  // Deterministic, APP-OWNED confidence from the retrieval layer. On the V2 path this
  // — never the model's self-reported uncertainty — is what we persist and render, so
  // the model cannot contradict a HIGH evidence determination with a LOW label.
  let v2Confidence: "high" | "qualified" | null = null;
  let v2ConfidenceBasis: string | null = null;
  const useV2 = !!deps.runRetrieval || isJarvisRetrievalV2Enabled();
  if (useV2) {
    const runV2 = deps.runRetrieval ?? ((c, m, t) => runRetrievalV2Turn(c, m, t, requestId));
    const v2 = await runV2(ctx, message, { lastClientId: thread.lastClientId });
    plan = v2.plan;
    v2DataBlock = v2.dataBlock;
    v2Trace = v2.trace;
    v2Confidence = v2.confidence ?? null;
    v2ConfidenceBasis = v2.confidenceBasis ?? null;
  } else {
    plan = await router(ctx, message, { lastClientId: thread.lastClientId });
  }

  // Ambiguous / unresolved referent ⇒ ask, deterministically. No provider call,
  // no data leaked. Persist the clarification as an ok assistant turn.
  if (plan.kind === "ambiguous_client" || plan.kind === "unknown_client") {
    const clarification =
      plan.kind === "ambiguous_client"
        ? // MULTIPLE credible matches ⇒ ask which, listing candidates.
          `I can help with that — which client do you mean: ${plan.candidates.map((c) => c.name).join(", ")}?`
        : // ZERO credible matches ⇒ NOT found (never phrased as ambiguity).
          plan.query
          ? `I couldn't find a client matching "${plan.query}" in the Portal.`
          : "I couldn't find a matching client in the Portal.";
    // A clarification IS an assistant success turn — only claim ok if it stored.
    const clarificationId = await tryPersistAssistant(repo, ctx, thread.id, requestId, {
      status: "ok",
      content: clarification,
      provenance: { contextKind: plan.kind, clarification: true },
    });
    if (clarificationId === null) return { ok: false, reason: "persist_failed", threadId: thread.id, requestId, persisted: false };
    await runHook(hooks?.onAssistant ? () => hooks.onAssistant!(clarificationId) : undefined);
    // NOTE: provider_started_at is deliberately NOT set — a clarification never calls the provider.
    return {
      ok: true,
      threadId: thread.id,
      requestId,
      assistantMessage: clarification,
      clarification: true,
      persisted: true,
    };
  }

  // (7) Assemble bounded context. Retrieval V2 (Client Intelligence) supplies a
  //     pre-serialized, bounded, secret-scanned evidence DATA block instead of V1
  //     ContextPackages — so when it is active we SKIP the V1 Context Engine
  //     assembly entirely (no duplicate reads), and only maintain the deterministic
  //     thread referent for a resolved client. When V2 is OFF, the V1 path below is
  //     byte-for-byte unchanged.
  let contexts: ContextPackage[] = [];
  if (v2DataBlock !== null) {
    if (plan.kind === "client") {
      // Update the deterministic thread referent ONLY after a successful resolve.
      await repo.updateLastClientId(ctx, thread.id, plan.clientId);
    }
  } else {
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
  }

  // Bounded history: last (historyTurns * 2) ok messages, chronological. Loaded
  // AFTER persisting the user message, so the current turn is included exactly
  // once (no duplication). Carries the durable row `id` (INTERNAL only).
  const history = await repo.loadBoundedHistory(ctx, thread.id, limits.historyTurns * 2);

  // R3 / F-04: build the PROVIDER-BOUND copy. Redact secrets in REPLAYED persisted
  // messages; preserve the CURRENT persisted user message unchanged (live input),
  // identified by EXACT durable row identity (id === userMessageId AND role === "user")
  // — never by content/position/timestamp. Any other row (incl. an assistant message,
  // or one lacking/mismatching the id) is replayed context and is scanned/redacted.
  // The raw repo result is NOT mutated; the internal `id` is stripped here so only
  // { role, content } reaches the provider.
  const providerMessages = history.map((m) =>
    m.id === userMessageId && m.role === "user"
      ? { role: m.role, content: m.content }
      : { role: m.role, content: redactIfSecret(m.content) }
  );

  // Retrieval V2 history-fit: current authoritative evidence must never be crowded
  // out by old conversation. When the whole prompt would exceed its ceiling, trim
  // the OLDEST replayed history first (never the current user message, never the
  // evidence). V1 path is untouched.
  let providerMessagesFinal = providerMessages;
  if (v2DataBlock !== null && providerMessages.length > 1) {
    const replayed = providerMessages.slice(0, -1);
    const current = providerMessages[providerMessages.length - 1];
    const fixedTokens = estimateTokens(buildSystemPromptFromData("")); // instructions + action catalog, excluding evidence
    const fit = fitHistory({
      fixedTokens,
      evidenceTokens: estimateTokens(v2DataBlock),
      historyTexts: replayed.map((m) => m.content),
    });
    providerMessagesFinal = [...replayed.slice(replayed.length - fit.keptCount), current];
    if (v2Trace) {
      v2Trace = {
        ...v2Trace,
        history: { turnsIncluded: providerMessagesFinal.length, estTokens: fit.keptTokens, reducedFromTarget: fit.reducedFromTarget },
      };
    }
  }

  // (8) Build the trusted prompt and call the provider under an owned deadline.
  //     CORRECTNESS-CRITICAL: durably mark provider_started_at BEFORE the provider
  //     sequence. Unlike the best-effort audit hooks, this is a HARD precondition —
  //     if the marker write fails we must NOT call the provider (or run bridges) and
  //     must NOT claim a provider request occurred. The failure is entirely before
  //     the external boundary, so it is an honest internal processing failure.
  const system = v2DataBlock !== null ? buildSystemPromptFromData(v2DataBlock) : buildSystemPrompt(contexts);
  if (hooks?.beforeProvider) {
    try {
      await hooks.beforeProvider();
    } catch {
      const stored = await persistFailure(repo, ctx, thread.id, requestId, "provider_start_failed");
      return { ok: false, reason: "provider_start_failed", threadId: thread.id, requestId, persisted: stored };
    }
  }
  // Scope the output-token allowance: V2 gets at least V2_MIN_OUTPUT_TOKENS (clamped);
  // V1 is byte-for-byte unchanged.
  const effectiveLimits: IntelligenceLimits =
    v2DataBlock !== null
      ? {
          ...limits,
          maxOutputTokens: Math.min(
            INTELLIGENCE_LIMIT_BOUNDS.maxOutputTokens.max,
            Math.max(limits.maxOutputTokens, V2_MIN_OUTPUT_TOKENS)
          ),
        }
      : limits;
  let resultText: string;
  let providerId: string;
  let model: string;
  let usage: unknown;
  let finishReason: string | null = null;
  let outputTokens: number | null = null;
  try {
    const result = await callProviderWithPolicy(
      deps.provider,
      // Every Jarvis turn (V1 and V2) requires the AssistantResponse contract, so we
      // request it as native structured output — the model returns one conforming JSON
      // object instead of free text. The strict parseAssistantResponse below still runs.
      { system, messages: providerMessagesFinal, jsonSchema: ASSISTANT_RESPONSE_SCHEMA },
      effectiveLimits
    );
    resultText = result.text;
    providerId = result.providerId; // TRUSTED adapter metadata, never model-claimed
    model = result.model;
    usage = result.usage;
    finishReason = result.finishReason; // "length" ⇒ stopped at the output-token limit (truncation)
    outputTokens = result.usage?.outputTokens ?? null;
  } catch (e) {
    const errorClass = isLLMProviderError(e) ? e.kind : "unavailable";
    const stored = await persistFailure(repo, ctx, thread.id, requestId, errorClass);
    return { ok: false, reason: errorClass, threadId: thread.id, requestId, persisted: stored };
  }
  await runHook(hooks?.onProviderResult ? () => hooks.onProviderResult!({ provider: providerId, model, usage }) : undefined);

  // (9) Validate the UNTRUSTED model output. Malformed ⇒ safe failure; never
  //     persist the raw blob as assistant content. On failure we persist ONLY safe,
  //     non-sensitive diagnostics (parse sub-reason, provider finishReason, output
  //     size) — never the raw text, prompt, or evidence — so truncation (finishReason
  //     "length") is self-evident next time without storing any content.
  const parsed = parseAssistantResponse(resultText);
  if (!parsed.ok) {
    const stored = await persistFailure(repo, ctx, thread.id, requestId, `invalid_response:${parsed.reason}`, {
      parseReason: parsed.reason,
      finishReason,
      rawLength: resultText.length,
      outputTokens,
    });
    return { ok: false, reason: "invalid_response", threadId: thread.id, requestId, persisted: stored };
  }
  const value = parsed.value;

  // Confidence resolution. On the V2 path the displayed/persisted confidence is
  // APP-OWNED — derived from the retrieval layer's deterministic answerConfidence, with
  // the model's self-reported uncertainty DISCARDED so it can never downgrade HIGH→LOW.
  // The V1 path is byte-for-byte unchanged (keeps the model's uncertainty).
  const effectiveUncertainty: ValidatedUncertainty | undefined =
    v2DataBlock !== null ? deterministicUncertainty(v2Confidence, v2ConfidenceBasis) : value.uncertainty;

  // (10) Persist assistant success with TRUSTED provenance/metadata, then return.
  const provenance: TrustedProvenance = {
    contextKind: plan.kind,
    clientId: plan.kind === "client" ? plan.clientId : null,
    historyMessages: history.length,
    contextMemoryCount: countMemory(contexts),
    contextPortalFactCount: countPortalFacts(contexts),
    // Retrieval V2 safe observability trace (counts/ids/status only; no free text).
    ...(v2Trace ? { retrieval: v2Trace } : {}),
  };

  // Durable persistence is a PRECONDITION of an ok:true result. If the write
  // throws, we do NOT tell the caller the turn succeeded.
  const assistantId = await tryPersistAssistant(repo, ctx, thread.id, requestId, {
    status: "ok",
    content: value.assistantMessage,
    reasoningSummary: value.reasoningSummary,
    uncertainty: effectiveUncertainty,
    // proposed_intent HAS a column (0067) — persist the VALIDATED (not executed)
    // proposal. memory_candidate has no column and is NOT written in Slice C;
    // it is returned to the caller only.
    proposedIntent: value.proposedIntent,
    provider: providerId,
    model,
    usage,
    provenance,
  });
  if (assistantId === null) return { ok: false, reason: "persist_failed", threadId: thread.id, requestId, persisted: false };
  await runHook(hooks?.onAssistant ? () => hooks.onAssistant!(assistantId) : undefined);

  // (11) Slice-D BRIDGES. Only reached once the assistant row is durably stored,
  //      so we never create an operational side effect for a turn whose record
  //      failed to persist. The model's proposals are UNTRUSTED suggestions; the
  //      bridges gate them into the existing trusted F1 / Memory systems.
  const { action, memory } = await runBridges({
    turnCtx: ctx,
    reauthorize,
    proposedIntent: value.proposedIntent,
    memoryCandidate: value.memoryCandidate,
    plan,
    requestId,
    deps,
    turnId,
  });

  return {
    ok: true,
    threadId: thread.id,
    requestId,
    assistantMessage: value.assistantMessage,
    proposedIntent: value.proposedIntent,
    memoryCandidate: value.memoryCandidate,
    uncertainty: effectiveUncertainty,
    persisted: true,
    action,
    memory,
  };
}

/**
 * Map the retrieval layer's deterministic confidence to the response-contract
 * uncertainty shape. HIGH ⇒ level "high" (no notes); QUALIFIED ⇒ level "medium" with
 * the deterministic basis as notes. `null` (no provider turn, or a defensive miss) ⇒
 * no uncertainty shown — NEVER falls back to the model's self-report. PURE.
 */
export function deterministicUncertainty(
  confidence: "high" | "qualified" | null,
  basis: string | null
): ValidatedUncertainty | undefined {
  if (confidence === "high") return { level: "high" };
  if (confidence === "qualified") return basis ? { level: "medium", notes: basis } : { level: "medium" };
  return undefined;
}

/** F1b lease window: a claimed turn is stale for future recovery after this. Never
 *  used by F1b to authorize a second provider call. */
const TURN_LEASE_MS = 5 * 60_000;

/** The transport idempotency key must be a UUID (the jarvis_turns column type). */
const DURABLE_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The typed outcome of a durable, replay-aware turn (F1b). This is the internal
 * primitive F1d will expose over transport. A same-key retry NEVER starts a second
 * provider sequence: it replays the durable turn or reports its in-progress/terminal
 * state. `conflict` (same key, different request hash) leaks NO stored-request data.
 */
export type DurableTurnOutcome =
  | { kind: "disabled" }
  | { kind: "not_authorized"; reason: string }
  | { kind: "invalid_input"; reason: string }
  | { kind: "conflict" }
  | { kind: "executed"; turnId: string; result: TurnResult }
  | { kind: "completed_replay"; turnId: string; result: Extract<TurnResult, { ok: true }> }
  | { kind: "in_progress"; turnId: string }
  | { kind: "failed_replay"; turnId: string; reason: string }
  | { kind: "abandoned_replay"; turnId: string; reason: string };

/**
 * Durable, transport-replay-aware Intelligence turn (F1b). Requires a trusted
 * transport idempotency key. Claims a durable turn (the DB unique constraint on
 * (workspace_id,user_id,idempotency_key) arbitrates concurrency), then either
 * replays an existing turn or executes a fresh one with set-once checkpointing.
 *
 * F1b is transport-replay safety ONLY — NOT workflow recovery and NOT model
 * re-execution. A processing turn (incl. a crash after the provider call) replays as
 * IN_PROGRESS and is never resumed/re-executed here; downstream operation-key
 * idempotency (F1/Memory) is F1c, so a durable side effect may exist while the turn
 * is still processing. Do not describe F1b as exactly-once action/Memory execution.
 */
export async function runDurableTurn(input: TurnInput, deps: TurnDeps): Promise<DurableTurnOutcome> {
  const pre = await preflight(input, deps);
  if (!pre.ok) {
    if (pre.kind === "disabled") return { kind: "disabled" };
    if (pre.kind === "not_authorized") return { kind: "not_authorized", reason: pre.reason };
    return { kind: "invalid_input", reason: pre.reason };
  }
  const { ctx, message } = pre;
  const idempotencyKey = input.idempotencyKey;
  if (!idempotencyKey) return { kind: "invalid_input", reason: "missing_idempotency_key" };
  // The transport key lands in the uuid `jarvis_turns.idempotency_key` column —
  // validate its shape at the boundary rather than surfacing a raw DB error.
  if (!DURABLE_KEY_RE.test(idempotencyKey)) return { kind: "invalid_input", reason: "invalid_idempotency_key" };

  const turnRepo = deps.turnRepo ?? createConversationTurnRepo();
  const clock = deps.now ?? Date.now;
  const requestId = (deps.uuid ?? (() => globalThis.crypto.randomUUID()))();
  // Hash the ORIGINAL transport envelope (input.threadId, not any created thread).
  const requestHash = computeRequestHash({
    workspaceId: ctx.workspaceId,
    userId: ctx.principalId,
    threadId: input.threadId ?? null,
    message,
  });

  // Atomic claim — the unique constraint is the sole concurrency arbiter.
  const claim = await turnRepo.claim({
    ctx,
    idempotencyKey,
    requestHash,
    correlationId: requestId,
    leaseExpiresAt: new Date(clock() + TURN_LEASE_MS).toISOString(),
  });

  if (claim.outcome === "existing") {
    const c = classifyExisting(claim.turn, requestHash);
    switch (c.kind) {
      case "conflict":
        return { kind: "conflict" };
      case "completed_replay":
        return { kind: "completed_replay", turnId: claim.turn.id, result: c.result };
      case "in_progress":
        return { kind: "in_progress", turnId: c.turnId };
      case "failed_replay":
        return { kind: "failed_replay", turnId: c.turnId, reason: c.reason };
      case "abandoned_replay":
        return { kind: "abandoned_replay", turnId: c.turnId, reason: c.reason };
      case "corrupt":
        // Fail closed: never replay an unvalidatable snapshot and never re-execute.
        return { kind: "in_progress", turnId: c.turnId };
    }
  }

  // CLAIMED — execute with set-once checkpoint hooks (best-effort audit linkage).
  const turnId = claim.turn.id;
  let providerMeta: ProviderMeta | undefined;
  const hooks: TurnHooks = {
    onThread: (tid) => turnRepo.setThreadId(turnId, tid),
    onUserMessage: (mid) => turnRepo.setUserMessageId(turnId, mid),
    beforeProvider: () => turnRepo.markProviderStarted(turnId, new Date(clock()).toISOString()),
    onProviderResult: (m) => {
      providerMeta = m;
    },
    onAssistant: (mid) => turnRepo.setAssistantMessageId(turnId, mid),
  };

  const result = await executeLifecycle({ ctx, message, input, deps, requestId, hooks, turnId });

  if (!result.ok) {
    await runHook(() => turnRepo.fail(turnId, result.reason));
    return { kind: "executed", turnId, result };
  }

  // Link the trusted downstream outcomes (best-effort) then finalize.
  const act = result.action;
  if (act && act.status === "approval_required") await runHook(() => turnRepo.setProposalId(turnId, act.proposalId));
  const mem = result.memory;
  if (mem && mem.status === "needs_confirmation") await runHook(() => turnRepo.setMemoryId(turnId, mem.memoryId));

  // Build the COMPLETE, fidelity-preserving snapshot, then size it FAIL-CLOSED.
  // LOCKED (F1b): no lossy reduction/truncation. If the faithful snapshot exceeds the
  // application byte ceiling we do NOT complete with a truncated substitute — we
  // transition the turn to a semantically honest `failed` state and surface the
  // failure. The provider/bridges already ran and are NOT re-executed; a replay of a
  // failed turn is FAILED_REPLAY, never a second provider sequence.
  const snapshot = buildResultSnapshot(result, providerMeta);
  const sized = validateResultSnapshot(snapshot);
  if (!sized.ok) {
    await runHook(() => turnRepo.fail(turnId, "result_too_large"));
    const failure: TurnResult = {
      ok: false,
      reason: "result_too_large",
      threadId: result.threadId,
      requestId,
      persisted: true,
    };
    return { kind: "executed", turnId, result: failure };
  }
  try {
    await turnRepo.complete(turnId, sized.value);
  } catch {
    // Completion write failed → the turn stays `processing`; a replay is IN_PROGRESS
    // and never re-executes. We do not claim durable success at the transport boundary.
    return { kind: "in_progress", turnId };
  }
  return { kind: "executed", turnId, result };
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
  /** Fresh, trusted, DB-backed bridge-time reauthorization (R2 / F-02) — never a snapshot. */
  reauthorize: () => Promise<JarvisContext | JarvisApiDenial>;
  proposedIntent?: ValidatedProposedIntent;
  memoryCandidate?: ValidatedMemoryCandidate;
  plan: ContextPlan;
  requestId: string;
  deps: TurnDeps;
  /** Durable turn id (F1c). Present ⇒ derive trusted per-slot operation keys. */
  turnId?: string;
}): Promise<{ action?: ActionBridgeResult; memory?: MemoryBridgeResult }> {
  const { turnCtx, reauthorize, proposedIntent, memoryCandidate, plan, requestId, deps, turnId } = args;

  // Trusted, server-generated operation keys for the current one-action/one-memory
  // turn. Derived ONLY from the durable jarvis_turns.id — never from the model, the
  // browser, the user, request_id, or the transport idempotency key. Absent on the
  // legacy keyless path (no durable turn ⇒ no idempotent effect slots).
  const actionOperationKey = turnId ? `turn:${turnId}:action:0` : undefined;
  const memoryOperationKey = turnId ? `turn:${turnId}:memory:0` : undefined;

  // Nothing proposed ⇒ no reauthorization, no bridge work.
  if (!proposedIntent && !memoryCandidate) {
    return { action: { status: "not_requested" }, memory: { status: "not_requested" } };
  }

  // Reauthorize ONCE at bridge time with a genuinely FRESH, trusted, DB-backed resolve
  // (R2 / F-02); both bridges share the fresh, checked context. A throw fails closed.
  let reauth: JarvisContext | JarvisApiDenial;
  try {
    reauth = await reauthorize();
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
    action = await bridgeProposedIntent({ ctx: freshCtx, intent: proposedIntent, plan, operationKey: actionOperationKey }, deps.actionBridge);
  } catch {
    action = proposedIntent
      ? { status: "failed", capabilityId: proposedIntent.capabilityId, reason: "bridge_error" }
      : { status: "not_requested" };
  }

  let memory: MemoryBridgeResult;
  try {
    memory = await bridgeMemoryCandidate({ ctx: freshCtx, candidate: memoryCandidate, plan, requestId, operationKey: memoryOperationKey }, deps.memoryBridge);
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
): Promise<string | null> {
  try {
    return await repo.persistAssistant(ctx, threadId, requestId, row);
  } catch {
    return null;
  }
}

/** Persist a SAFE failure row (generic copy; never raw response/stack/secret/
 *  prompt/context). Returns whether the row was durably stored. */
async function persistFailure(
  repo: ConversationRepo,
  ctx: JarvisContext,
  threadId: string,
  requestId: string,
  errorClass: string,
  /** SAFE, non-sensitive diagnostics only (sizes/enums) — NEVER raw output, prompt,
   *  evidence content, secrets, or free-text provider content. */
  extra?: Record<string, unknown>
): Promise<boolean> {
  const id = await tryPersistAssistant(repo, ctx, threadId, requestId, {
    status: "error",
    content: SAFE_FAILURE_MESSAGE,
    provenance: { errorClass, ...(extra ?? {}) },
  });
  return id !== null;
}
