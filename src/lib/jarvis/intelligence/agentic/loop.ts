import "server-only";

import type {
  LLMProvider,
  LLMToolMessage,
  LLMToolSpec,
  LLMToolUseBlock,
  LLMToolResultBlock,
  LLMUsage,
} from "@/lib/jarvis/llm/provider";
import { isLLMProviderError } from "@/lib/jarvis/llm/errors";
import type { JarvisContext } from "@/lib/jarvis/identity";
import type { RetrieverContext } from "@/lib/jarvis/retrieval/types";
import { estimateTokens } from "@/lib/jarvis/retrieval/evidence/serialize";
import { READ_TOOL_REGISTRY, readToolSpecs, executeReadTool } from "@/lib/jarvis/retrieval/tools/registry";
import type { ReadToolOutcome } from "@/lib/jarvis/retrieval/tools/types";
import { ASSISTANT_RESPONSE_TOOL_NAME, ASSISTANT_RESPONSE_JSON_SCHEMA, ASSISTANT_RESPONSE_SCHEMA, parseAssistantResponse } from "../response-contract";
import type { ValidatedAssistantResponse } from "../types";
import type { AgenticTrace, AgenticToolCall, AgenticTermination } from "./trace";

/**
 * Jarvis Milestone A — the bounded, multi-tool agentic READ loop.
 *
 * Deterministic control around an UNTRUSTED model that may call registered read tools.
 * Guarantees: ≤ MAX_ROUNDS tool rounds (+ at most one forced finalize), a shared
 * evidence-token budget across the whole turn, per-tool timeout, wall-clock deadline,
 * failure isolation, identical-call de-duplication, and a final answer that ALWAYS goes
 * through the strict response contract. The model can invoke ONLY registered tools; it
 * can never run SQL, widen scope, or invent tool results (results come only from the
 * trusted executor). Application-owned confidence is computed here, not by the model.
 */

export const AGENTIC_DEFAULTS = {
  MAX_ROUNDS: 4,
  EVIDENCE_BUDGET_TOKENS: 10_000, // shared across the whole turn (mirrors BUDGET.EVIDENCE_HARD)
  PER_TOOL_TIMEOUT_MS: 8_000,
  FINALIZE_FLOOR_MS: 1_500, // need at least this much wall-clock to attempt a finalize call
} as const;

const RESPONSE_TOOL: LLMToolSpec = {
  name: ASSISTANT_RESPONSE_TOOL_NAME,
  description: ASSISTANT_RESPONSE_SCHEMA.description,
  inputSchema: ASSISTANT_RESPONSE_JSON_SCHEMA,
};

export interface AgenticLoopDeps {
  provider: LLMProvider;
  rc: RetrieverContext;
  ctx: JarvisContext;
  system: string;
  /** Prior turns (role/content) + the current user message, in order. */
  history: LLMToolMessage[];
  maxOutputTokens: number;
  /** Absolute epoch-ms wall-clock deadline for the whole loop. */
  deadlineMs: number;
  signal?: AbortSignal;
  // ── seams (tests) ──
  execute?: typeof executeReadTool;
  specs?: LLMToolSpec[];
  now?: () => number;
  maxRounds?: number;
  perToolTimeoutMs?: number;
  evidenceBudget?: number;
}

export interface AgenticSuccess {
  ok: true;
  value: ValidatedAssistantResponse;
  confidence: "high" | "qualified";
  confidenceBasis: string;
  trace: AgenticTrace;
  providerId: string;
  model: string;
  usage: LLMUsage;
}
export interface AgenticFailure {
  ok: false;
  reason: string;
  trace: AgenticTrace;
}
export type AgenticOutcome = AgenticSuccess | AgenticFailure;

/** Stable, key-sorted serialization for identical-call de-duplication. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}

/** Race a tool run against a timeout, clearing the timer so no dangling handle remains. */
async function withTimeout(p: Promise<ReadToolOutcome>, ms: number): Promise<ReadToolOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ReadToolOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, status: "timeout", message: "tool timeout" }), Math.max(1, ms));
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runAgenticLoop(deps: AgenticLoopDeps): Promise<AgenticOutcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  const execute = deps.execute ?? executeReadTool;
  const specs = deps.specs ?? readToolSpecs();
  const maxRounds = deps.maxRounds ?? AGENTIC_DEFAULTS.MAX_ROUNDS;
  const perToolTimeout = deps.perToolTimeoutMs ?? AGENTIC_DEFAULTS.PER_TOOL_TIMEOUT_MS;
  const evidenceBudget = deps.evidenceBudget ?? AGENTIC_DEFAULTS.EVIDENCE_BUDGET_TOKENS;
  const tools: LLMToolSpec[] = [...specs, RESPONSE_TOOL];

  const messages: LLMToolMessage[] = [...deps.history];
  const toolCalls: AgenticToolCall[] = [];
  const dedupe = new Map<string, string>();
  let evidenceTokens = 0;
  let providerCalls = 0;
  let rounds = 0;
  let degraded = false;
  let usage: LLMUsage = { inputTokens: 0, outputTokens: 0 };
  let providerId = deps.provider.id;
  let model = deps.provider.model;

  const addUsage = (u: LLMUsage) => {
    usage = {
      inputTokens: (usage.inputTokens ?? 0) + (u.inputTokens ?? 0),
      outputTokens: (usage.outputTokens ?? 0) + (u.outputTokens ?? 0),
    };
  };
  const remaining = () => deps.deadlineMs - now();
  const callBudget = () => Math.max(1, Math.min(remaining(), 60_000));

  const confidenceBasis = () =>
    degraded
      ? "Some required Portal reads could not be completed this turn (see trace); any answer depending on them is qualified, and absence was not asserted."
      : "Every stated fact is grounded in Portal reads that succeeded this turn. Bounded lists are coverage, not lower confidence.";

  const buildTrace = (termination: AgenticTermination): AgenticTrace => ({
    mode: "agentic",
    rounds,
    maxRounds,
    providerCalls,
    toolCalls,
    evidenceEstTokens: evidenceTokens,
    evidenceBudget,
    termination,
    confidence: degraded ? "qualified" : "high",
    confidenceBasis: confidenceBasis(),
    totalMs: now() - started,
  });

  if (typeof deps.provider.completeWithTools !== "function") {
    return { ok: false, reason: "provider_no_tools", trace: buildTrace("no_tool") };
  }

  const finalize = (raw: string, termination: AgenticTermination): AgenticOutcome => {
    const parsed = parseAssistantResponse(raw);
    if (!parsed.ok) return { ok: false, reason: `invalid_response:${parsed.reason}`, trace: buildTrace(termination) };
    return {
      ok: true,
      value: parsed.value,
      confidence: degraded ? "qualified" : "high",
      confidenceBasis: confidenceBasis(),
      trace: buildTrace(termination),
      providerId,
      model,
      usage,
    };
  };

  try {
    for (rounds = 1; rounds <= maxRounds; rounds++) {
      if (remaining() <= AGENTIC_DEFAULTS.FINALIZE_FLOOR_MS) {
        // Not enough time for another full round; break to the forced finalize.
        break;
      }
      providerCalls++;
      const resp = await deps.provider.completeWithTools!({
        system: deps.system,
        messages,
        tools,
        toolChoice: { type: "any" }, // force SOME tool call — never free prose
        maxOutputTokens: deps.maxOutputTokens,
        timeoutMs: callBudget(),
        signal: deps.signal,
      });
      providerId = resp.providerId;
      model = resp.model;
      addUsage(resp.usage);

      // Final answer emitted?
      const emit = resp.toolUses.find((t) => t.name === ASSISTANT_RESPONSE_TOOL_NAME);
      if (emit) return finalize(JSON.stringify(emit.input ?? {}), "final_answer");

      const readCalls = resp.toolUses.filter((t) => READ_TOOL_REGISTRY.has(t.name));
      if (readCalls.length === 0) {
        // No recognised tool and no final answer — stop looping and force a finalize.
        break;
      }

      // Echo the model's tool_use blocks back as the assistant turn.
      messages.push({ role: "assistant", content: readCalls.map((t) => ({ type: "tool_use", id: t.id, name: t.name, input: t.input } as LLMToolUseBlock)) });

      const resultBlocks: LLMToolResultBlock[] = [];
      for (const tu of readCalls) {
        const descriptor = READ_TOOL_REGISTRY.get(tu.name)!;
        const key = `${tu.name}:${stableStringify(tu.input)}`;
        const tStart = now();

        if (dedupe.has(key)) {
          toolCalls.push({ name: tu.name, scope: descriptor.scope, status: "deduped", domains: [], total: null, shown: 0, truncated: false, tookMs: 0 });
          resultBlocks.push({ type: "tool_result", toolUseId: tu.id, content: "(identical call already made this turn — reuse the previous result; do not repeat)" });
          continue;
        }
        if (evidenceTokens >= evidenceBudget) {
          degraded = true;
          toolCalls.push({ name: tu.name, scope: descriptor.scope, status: "budget_skipped", domains: [], total: null, shown: 0, truncated: true, tookMs: 0 });
          resultBlocks.push({ type: "tool_result", toolUseId: tu.id, content: "(evidence budget reached — not executed; answer with the evidence already gathered)", isError: true });
          continue;
        }

        const outcome = await withTimeout(execute(tu.name, tu.input, deps.rc, deps.ctx), Math.min(perToolTimeout, callBudget()));
        const tookMs = now() - tStart;
        if (outcome.ok) {
          const content = outcome.result.content;
          evidenceTokens += estimateTokens(content);
          if (outcome.result.degraded) degraded = true;
          dedupe.set(key, content);
          toolCalls.push({ name: tu.name, scope: descriptor.scope, status: "ok", domains: outcome.result.domains, total: outcome.result.total, shown: outcome.result.shown, truncated: outcome.result.truncated, tookMs });
          resultBlocks.push({ type: "tool_result", toolUseId: tu.id, content });
        } else {
          if (outcome.status === "error" || outcome.status === "timeout" || outcome.status === "unauthorized") degraded = true;
          toolCalls.push({ name: tu.name, scope: descriptor.scope, status: outcome.status, domains: [], total: null, shown: 0, truncated: false, tookMs });
          resultBlocks.push({ type: "tool_result", toolUseId: tu.id, content: `tool ${tu.name} could not run (${outcome.status}). Do not assume data is empty.`, isError: true });
        }
      }
      messages.push({ role: "user", content: resultBlocks });
    }

    // Forced finalize: produce a schema-valid answer from the evidence gathered.
    if (remaining() <= AGENTIC_DEFAULTS.FINALIZE_FLOOR_MS) {
      return { ok: false, reason: "deadline", trace: buildTrace("deadline") };
    }
    messages.push({
      role: "user",
      content: "You have gathered enough Portal evidence. Now emit the assistant response object as your final answer, using ONLY the evidence above. Do not call any more read tools.",
    });
    providerCalls++;
    const finalResp = await deps.provider.completeWithTools!({
      system: deps.system,
      messages,
      tools,
      toolChoice: { type: "tool", name: ASSISTANT_RESPONSE_TOOL_NAME },
      maxOutputTokens: deps.maxOutputTokens,
      timeoutMs: callBudget(),
      signal: deps.signal,
    });
    providerId = finalResp.providerId;
    model = finalResp.model;
    addUsage(finalResp.usage);
    const emit = finalResp.toolUses.find((t) => t.name === ASSISTANT_RESPONSE_TOOL_NAME);
    const termination: AgenticTermination = rounds > maxRounds ? "max_rounds" : "finalize_forced";
    if (!emit) return { ok: false, reason: "invalid_response:no_emit", trace: buildTrace(termination) };
    return finalize(JSON.stringify(emit.input ?? {}), termination);
  } catch (e) {
    const reason = isLLMProviderError(e) ? e.kind : "unavailable";
    return { ok: false, reason, trace: buildTrace("deadline") };
  }
}
