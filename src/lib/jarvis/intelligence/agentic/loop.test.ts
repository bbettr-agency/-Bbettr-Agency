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

// Name-aware success: emits the SAME coverage contributions the real tools do, so the
// loop's coverage map reflects per-tool/metric coverage in unit tests.
function okForTool(name: string, input: unknown): ReadToolOutcome {
  const base = { content: "ok", total: 1, shown: 1, truncated: false, domains: ["x"] };
  if (name === "portal_planner_today") return { ok: true, result: { ...base, coverageContributions: [{ domain: "tasks_today", level: "full", scope: { breadth: "viewer" } }] } };
  if (name === "portal_list_clients") return { ok: true, result: { ...base, coverageContributions: [{ domain: "clients", level: "full", scope: { breadth: "agency" } }] } };
  if (name === "portal_aggregate") {
    const metric = (input as { metric?: string })?.metric ?? "";
    const map: Record<string, { domain: "invoices" | "onboarding" | "client_updates" }> = {
      unpaid_invoices: { domain: "invoices" },
      incomplete_onboarding: { domain: "onboarding" },
      stale_clients: { domain: "client_updates" },
    };
    const d = map[metric];
    return { ok: true, result: { ...base, coverageContributions: d ? [{ domain: d.domain, level: "signal", scope: { breadth: "agency" } }] : [] } };
  }
  return { ok: true, result: base };
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
  it("terminates early when the model emits in round 1 — but with ZERO reads that is UNAVAILABLE, never high", async () => {
    const { provider, calls } = makeProvider([emit("done")]);
    const res = await runAgenticLoop(baseDeps({ provider }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.assistantMessage).toBe("done");
      expect(res.trace.termination).toBe("final_answer");
      expect(res.trace.providerCalls).toBe(1);
      // Reliability contract: an answer grounded in NO authoritative read is UNAVAILABLE
      // and must NOT be reported as high confidence.
      expect(res.trace.reliability).toBe("unavailable");
      expect(res.trace.confidence).toBe("qualified");
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

  it("a tool reporting PARTIAL coverage ⇒ reliability partial (qualified)", async () => {
    const { provider } = makeProvider([[{ name: "portal_planner_today", input: {} }], emit()]);
    const execute = vi.fn(async (): Promise<ReadToolOutcome> => ({ ok: true, result: { content: "bounded", total: 1, shown: 1, truncated: true, domains: ["tasks"], coverage: "partial" } }));
    const res = await runAgenticLoop(baseDeps({ provider, execute }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.reliability).toBe("partial");
      expect(res.trace.reliability).toBe("partial");
      expect(res.confidence).toBe("qualified");
    }
  });

  it("a tool reporting UNAVAILABLE coverage ⇒ reliability unavailable (never high)", async () => {
    const { provider } = makeProvider([[{ name: "portal_planner_today", input: {} }], emit()]);
    const execute = vi.fn(async (): Promise<ReadToolOutcome> => ({ ok: true, result: { content: "source unavailable", total: null, shown: 0, truncated: false, domains: ["tasks"], coverage: "unavailable", degraded: true } }));
    const res = await runAgenticLoop(baseDeps({ provider, execute }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.reliability).toBe("unavailable"); // the only read was unavailable → no verified coverage
      expect(res.confidence).toBe("qualified");
    }
  });

  it("a fully successful read ⇒ reliability verified (high)", async () => {
    const { provider } = makeProvider([[{ name: "portal_planner_today", input: {} }], emit()]);
    const execute = vi.fn(async () => okOutcome("12 total (7 completed, 5 remaining)"));
    const res = await runAgenticLoop(baseDeps({ provider, execute }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.reliability).toBe("verified");
      expect(res.confidence).toBe("high");
    }
  });

  // ── Correction 3: coverage-aware reliability (question coverage × source coverage) ──
  const userMsg = (content: string) => [{ role: "user" as const, content }];

  it("NARROW Planner Today question, complete retrieval ⇒ VERIFIED", async () => {
    const { provider } = makeProvider([[{ name: "portal_planner_today", input: {} }], emit()]);
    const execute = vi.fn(async () => okOutcome("12 total (7 completed, 5 remaining)"));
    const res = await runAgenticLoop(baseDeps({ provider, execute, history: userMsg("What tasks do I have in Planner Today?") }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.trace.questionBreadth).toBe("narrow");
      expect(res.reliability).toBe("verified");
      expect(res.confidence).toBe("high");
    }
  });

  it("BROAD agency question with ONLY Planner checked ⇒ PARTIAL (tool success ≠ verified)", async () => {
    const { provider } = makeProvider([[{ name: "portal_planner_today", input: {} }], emit()]);
    const execute = vi.fn(async () => okOutcome("5 remaining today"));
    const res = await runAgenticLoop(baseDeps({ provider, execute, history: userMsg("What needs my attention across Bbettr?") }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.trace.questionBreadth).toBe("broad");
      expect(res.reliability).toBe("partial");
      expect(res.confidence).toBe("qualified");
      // Surfaces important unexamined areas.
      expect(res.trace.coverage.notChecked).toContain("Meetings / calendar");
      expect(res.trace.coverage.notChecked).toContain("Finance (QuickBooks/PayFast)");
    }
  });

  it("BROAD question with several successful tools but missing domains ⇒ PARTIAL", async () => {
    const { provider } = makeProvider([
      [
        { name: "portal_planner_today", input: {} },
        { name: "portal_list_clients", input: {} },
        { name: "portal_aggregate", input: { metric: "unpaid_invoices" } },
      ],
      emit(),
    ]);
    const execute = vi.fn(async (name: string, input: unknown) => okForTool(name, input));
    const res = await runAgenticLoop(baseDeps({ provider, execute, history: userMsg("Is everything okay with my business?") }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.reliability).toBe("partial"); // unsupported agency domains remain
      // tasks_today was FULL (planner_today viewer), clients SIGNAL/FULL (list), invoices SIGNAL (aggregate).
      expect([...res.trace.coverage.full, ...res.trace.coverage.signalOnly]).toEqual(
        expect.arrayContaining(["Planner tasks (today)", "Client directory", "Unpaid invoices"])
      );
      // invoices was checked (as a signal) ⇒ must NOT be reported as not-checked.
      expect(res.trace.coverage.notChecked).not.toContain("Unpaid invoices");
    }
  });

  it("reproduces & resolves the Preview contradiction: a stale-filter list_clients records client_updates as SIGNAL (never NOT CHECKED)", async () => {
    // Model: planner_today (full) + list_clients({stale_updates_days}) which now contributes
    // clients + client_updates SIGNAL. client_updates must NOT appear under NOT CHECKED.
    const { provider } = makeProvider([
      [
        { name: "portal_planner_today", input: {} },
        { name: "portal_list_clients", input: { stale_updates_days: 14 } },
      ],
      emit(),
    ]);
    const execute = vi.fn(async (name: string, input: unknown): Promise<ReadToolOutcome> => {
      if (name === "portal_planner_today") return { ok: true, result: { content: "today", total: 1, shown: 1, truncated: false, domains: ["tasks"], coverageContributions: [{ domain: "tasks_today", level: "full", scope: { breadth: "viewer" } }] } };
      // list_clients with a stale filter → clients + client_updates SIGNAL (what the fix emits)
      void input;
      return { ok: true, result: { content: "14 of 14", total: 14, shown: 14, truncated: false, domains: ["clients", "updates"], coverageContributions: [
        { domain: "clients", level: "signal", scope: { breadth: "agency" } },
        { domain: "client_updates", level: "signal", scope: { breadth: "agency" } },
      ] } };
    });
    const res = await runAgenticLoop(baseDeps({ provider, execute, history: userMsg("What needs my attention across Bbettr?") }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.trace.coverage.signalOnly).toContain("Client update recency");
      expect(res.trace.coverage.notChecked).not.toContain("Client update recency"); // the fixed contradiction
      expect(res.reliability).toBe("partial"); // still partial (unsupported domains remain)
    }
  });

  it("RECURRING-reminder question with only today's projections ⇒ NOT verified", async () => {
    const { provider } = makeProvider([[{ name: "portal_planner_today", input: {} }], emit()]);
    const execute = vi.fn(async () => okOutcome("today's recurring occurrence"));
    const res = await runAgenticLoop(baseDeps({ provider, execute, history: userMsg("What recurring reminders do I have?") }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.reliability).toBe("partial");
      expect(res.trace.coverage.notChecked).toContain("Recurring reminders (full)");
    }
  });

  it("BROAD question with a FAILED required source ⇒ partial (never verified)", async () => {
    const { provider } = makeProvider([[{ name: "portal_aggregate", input: { metric: "overdue_tasks" } }], emit()]);
    const execute = vi.fn(async (): Promise<ReadToolOutcome> => ({ ok: false, status: "error", message: "x" }));
    const res = await runAgenticLoop(baseDeps({ provider, execute, history: userMsg("What needs my attention?") }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      // No successful read at all ⇒ unavailable (and certainly not verified).
      expect(res.reliability).toBe("unavailable");
      expect(res.confidence).toBe("qualified");
    }
  });

  it("the safe trace never contains raw tool-result content", async () => {
    const { provider } = makeProvider([[{ name: "portal_list_clients", input: {} }], emit()]);
    const execute = vi.fn(async () => okOutcome("SECRET_ROW_DATA_12345"));
    const res = await runAgenticLoop(baseDeps({ provider, execute }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(JSON.stringify(res.trace)).not.toContain("SECRET_ROW_DATA_12345");
  });
});
