import { describe, it, expect, vi } from "vitest";
import { runAgenticLoop, type AgenticLoopDeps } from "./loop";
import { ASSISTANT_RESPONSE_TOOL_NAME } from "../response-contract";
import { LLMProviderError } from "@/lib/jarvis/llm/errors";
import type { LLMProvider, LLMToolResult, LLMToolUseBlock } from "@/lib/jarvis/llm/provider";
import type { ReadToolOutcome } from "@/lib/jarvis/retrieval/tools/types";
import type { RetrieverContext } from "@/lib/jarvis/retrieval/types";
import type { JarvisContext } from "@/lib/jarvis/identity";

const CTX = { principalId: "u1", workspaceId: "w1", grants: new Set(["portal.read"]) } as JarvisContext;
const RC = { ctx: CTX, supabase: {}, now: () => new Date() } as unknown as RetrieverContext;

type ScriptStep = Array<{ name: string; input: unknown }>;

function emit(message = "Here is the answer."): ScriptStep {
  return [{ name: ASSISTANT_RESPONSE_TOOL_NAME, input: { assistant_message: message } }];
}

/** Provider that returns scripted tool_uses per call; throws once if `throwOnCall` set. */
function makeProvider(script: ScriptStep[], opts: { throwOnCall?: number } = {}) {
  let call = 0;
  const provider: LLMProvider = {
    id: "mockP",
    model: "mockM",
    complete: vi.fn(),
    completeWithTools: vi.fn(async (): Promise<LLMToolResult> => {
      call++;
      if (opts.throwOnCall === call) throw new LLMProviderError("unavailable", { providerId: "mockP", safeDetail: "x" });
      const step = script[Math.min(call - 1, script.length - 1)] ?? emit();
      const toolUses: LLMToolUseBlock[] = step.map((s, i) => ({ type: "tool_use", id: `tu-${call}-${i}`, name: s.name, input: s.input }));
      return { toolUses, text: "", providerId: "mockP", model: "mockM", finishReason: "tool_use", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 };
    }),
  };
  return { provider, calls: () => call };
}

function okOutcome(content: string, degraded = false): ReadToolOutcome {
  return { ok: true, result: { content, total: 1, shown: 1, truncated: false, domains: ["clients"], degraded } };
}

function baseDeps(over: Partial<AgenticLoopDeps>): AgenticLoopDeps {
  return {
    provider: makeProvider([emit()]).provider,
    rc: RC,
    ctx: CTX,
    system: "SYS",
    history: [{ role: "user", content: "what is happening?" }],
    maxOutputTokens: 2000,
    deadlineMs: Date.now() + 60_000,
    execute: vi.fn(async () => okOutcome("data")),
    ...over,
  };
}

describe("agentic loop — termination", () => {
  it("terminates early when the model emits the final answer in round 1 (1 provider call)", async () => {
    const { provider, calls } = makeProvider([emit("done")]);
    const res = await runAgenticLoop(baseDeps({ provider }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.assistantMessage).toBe("done");
      expect(res.trace.termination).toBe("final_answer");
      expect(res.trace.providerCalls).toBe(1);
      expect(res.trace.confidence).toBe("high");
    }
    expect(calls()).toBe(1);
  });

  it("calls a read tool then emits (2 provider calls, 1 tool call)", async () => {
    const { provider } = makeProvider([[{ name: "portal_list_clients", input: { status: "active" } }], emit()]);
    const execute = vi.fn(async () => okOutcome("3 active clients"));
    const res = await runAgenticLoop(baseDeps({ provider, execute }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.trace.providerCalls).toBe(2);
      expect(res.trace.toolCalls).toHaveLength(1);
      expect(res.trace.toolCalls[0]).toMatchObject({ name: "portal_list_clients", status: "ok" });
    }
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("enforces the maximum number of tool rounds, then force-finalizes", async () => {
    // Model NEVER emits — always calls a read tool. maxRounds=2 ⇒ 2 loop rounds + 1 forced finalize.
    // 2 rounds each call a (distinct) read tool, then the forced finalize (call 3) emits.
    const read1: ScriptStep = [{ name: "portal_aggregate", input: { metric: "open_tasks" } }];
    const read2: ScriptStep = [{ name: "portal_aggregate", input: { metric: "overdue_tasks" } }];
    const { provider } = makeProvider([read1, read2, emit()]);
    const res = await runAgenticLoop(baseDeps({ provider, maxRounds: 2 }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.trace.rounds).toBe(3); // loop counter lands at maxRounds+1
      expect(res.trace.termination).toBe("max_rounds");
      expect(res.trace.providerCalls).toBe(3); // 2 rounds + 1 forced finalize
    }
  });

  it("provider without tool support fails closed", async () => {
    const provider: LLMProvider = { id: "p", model: "m", complete: vi.fn() };
    const res = await runAgenticLoop(baseDeps({ provider }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("provider_no_tools");
  });
});

describe("agentic loop — safety & isolation", () => {
  it("suppresses identical repeated tool calls in the same turn", async () => {
    const dup: ScriptStep = [
      { name: "portal_aggregate", input: { metric: "open_tasks" } },
      { name: "portal_aggregate", input: { metric: "open_tasks" } }, // identical ⇒ deduped
    ];
    const { provider } = makeProvider([dup, emit()]);
    const execute = vi.fn(async () => okOutcome("open tasks: 4"));
    const res = await runAgenticLoop(baseDeps({ provider, execute }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      const statuses = res.trace.toolCalls.map((t) => t.status);
      expect(statuses).toContain("ok");
      expect(statuses).toContain("deduped");
    }
    expect(execute).toHaveBeenCalledTimes(1); // the duplicate was NOT executed
  });

  it("isolates a tool timeout and marks the turn qualified", async () => {
    const { provider } = makeProvider([[{ name: "portal_aggregate", input: { metric: "overdue_tasks" } }], emit()]);
    const execute = vi.fn(() => new Promise<ReadToolOutcome>(() => {})); // never resolves
    const res = await runAgenticLoop(baseDeps({ provider, execute, perToolTimeoutMs: 10 }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.trace.toolCalls[0].status).toBe("timeout");
      expect(res.trace.confidence).toBe("qualified"); // app-owned: a failed read qualifies
    }
  });

  it("isolates a partial tool failure (one tool errors) and qualifies the answer", async () => {
    const { provider } = makeProvider([
      [
        { name: "portal_aggregate", input: { metric: "open_tasks" } },
        { name: "portal_list_clients", input: { status: "active" } },
      ],
      emit(),
    ]);
    const execute = vi.fn(async (name: string) => (name === "portal_aggregate" ? ({ ok: false, status: "error", message: "x" } as ReadToolOutcome) : okOutcome("ok")));
    const res = await runAgenticLoop(baseDeps({ provider, execute }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.trace.confidence).toBe("qualified");
      expect(res.trace.toolCalls.some((t) => t.status === "error")).toBe(true);
    }
  });

  it("stops executing reads once the shared evidence budget is exhausted", async () => {
    const two: ScriptStep = [
      { name: "portal_list_clients", input: { status: "active" } },
      { name: "portal_aggregate", input: { metric: "open_tasks" } },
    ];
    const { provider } = makeProvider([two, emit()]);
    const execute = vi.fn(async () => okOutcome("x".repeat(40))); // ~10 tokens, over a budget of 1
    const res = await runAgenticLoop(baseDeps({ provider, execute, evidenceBudget: 1 }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.trace.toolCalls.some((t) => t.status === "budget_skipped")).toBe(true);
      expect(res.trace.confidence).toBe("qualified");
    }
    expect(execute).toHaveBeenCalledTimes(1); // the second read was skipped, not executed
  });

  it("maps a provider failure to a safe reason (no throw)", async () => {
    const { provider } = makeProvider([emit()], { throwOnCall: 1 });
    const res = await runAgenticLoop(baseDeps({ provider }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("unavailable");
  });

  it("fails closed as invalid_response when the forced finalize emits nothing", async () => {
    // Model never emits and the forced finalize returns no emit tool_use.
    const noEmit: ScriptStep = [{ name: "portal_aggregate", input: { metric: "open_tasks" } }];
    const { provider } = makeProvider([noEmit, []]); // round1 reads; finalize returns []
    const res = await runAgenticLoop(baseDeps({ provider, maxRounds: 1 }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("invalid_response:no_emit");
  });

  it("the safe trace never contains raw tool-result content", async () => {
    const { provider } = makeProvider([[{ name: "portal_list_clients", input: {} }], emit()]);
    const execute = vi.fn(async () => okOutcome("SECRET_ROW_DATA_12345"));
    const res = await runAgenticLoop(baseDeps({ provider, execute }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(JSON.stringify(res.trace)).not.toContain("SECRET_ROW_DATA_12345");
  });
});
