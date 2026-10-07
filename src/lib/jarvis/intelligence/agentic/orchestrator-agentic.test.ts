import { describe, it, expect, beforeEach, vi } from "vitest";

// Agentic path ON by default for this suite (overridable per test via deps.agenticRead).
vi.mock("@/lib/flags", () => ({
  isJarvisEnabled: vi.fn(() => true),
  isJarvisIntelligenceEnabled: vi.fn(() => true),
  isJarvisRetrievalV2Enabled: vi.fn(() => false),
  isJarvisAgenticReadEnabled: vi.fn(() => true),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ id: "admin1", role: "admin" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/jarvis/retrieval/pipeline", () => ({ runRetrievalV2Turn: vi.fn() }));

import { runIntelligenceTurn, type TurnDeps, type ContextAssembler } from "../orchestrator";
import { runRetrievalV2Turn } from "@/lib/jarvis/retrieval/pipeline";
import type { AgenticOutcome } from "./loop";
import type { AgenticTrace } from "./trace";
import type { ConversationRepo, ConversationThread, AssistantRow } from "../repository";
import type { ContextPlan } from "../types";
import type { JarvisContext } from "@/lib/jarvis/identity";
import type { IntelligenceLimits } from "@/lib/jarvis/llm/limits";
import type { LLMProvider } from "@/lib/jarvis/llm/provider";
import type { ContextPackage } from "@/lib/jarvis/memory/context-shape";

const CTX: JarvisContext = { principalId: "u1", workspaceId: "w1", grants: new Set(["jarvis.use"]) };
const LIMITS: IntelligenceLimits = { historyTurns: 10, maxOutputTokens: 1200, timeoutMs: 30_000, maxProviderCallsPerTurn: 1, maxTransientRetries: 1 };

const TRACE: AgenticTrace = {
  mode: "agentic",
  rounds: 2,
  maxRounds: 4,
  providerCalls: 2,
  toolCalls: [{ name: "portal_aggregate", scope: "agency", status: "ok", domains: ["clients"], total: 4, shown: 4, truncated: false, tookMs: 1 }],
  evidenceEstTokens: 120,
  evidenceBudget: 10000,
  termination: "final_answer",
  confidence: "high",
  confidenceBasis: "grounded",
  totalMs: 5,
};

function agenticSuccess(over: Partial<Extract<AgenticOutcome, { ok: true }>> = {}): AgenticOutcome {
  return {
    ok: true,
    value: { assistantMessage: "Across the agency: 4 clients." },
    confidence: "high",
    confidenceBasis: "grounded",
    trace: TRACE,
    providerId: "trusted-provider",
    model: "trusted-model",
    usage: { inputTokens: 10, outputTokens: 5 },
    ...over,
  };
}

function makeRepo() {
  const persisted: Array<AssistantRow & { requestId: string }> = [];
  const repo: ConversationRepo = {
    createThread: async (): Promise<ConversationThread> => ({ id: "t1", lastClientId: null }),
    loadAuthorizedThread: async (_c, id): Promise<ConversationThread | null> => ({ id, lastClientId: null }),
    persistUserMessage: async () => "umsg-1",
    loadBoundedHistory: async () => [{ id: "umsg-1", role: "user", content: "what is happening across the agency?" }],
    updateLastClientId: vi.fn(async () => {}),
    persistAssistant: async (_c, _t, requestId: string, row: AssistantRow): Promise<string> => {
      persisted.push({ ...row, requestId });
      return "amsg-1";
    },
  };
  return { repo, persisted };
}

const noopProvider: LLMProvider = { id: "mockP", model: "mockM", complete: vi.fn() };

function emptyPkg(kind: ContextPackage["kind"]): ContextPackage {
  return { kind, subjectId: null, generatedAt: "2026-01-01T00:00:00Z", portal: { authoritative: true, sections: [] }, memory: [], openCommitments: [], unresolvedConflicts: [], caps: { memory: 20, commitments: 15, conflicts: 15 }, truncated: {} };
}
const assembler: ContextAssembler = { agency: vi.fn(async () => emptyPkg("agency")), user: vi.fn(async () => emptyPkg("user")), client: vi.fn(async () => emptyPkg("client")) };

function deps(over: Partial<TurnDeps> = {}): TurnDeps {
  return { provider: noopProvider, resolveContext: async () => CTX, repo: makeRepo().repo, assembler, limits: LIMITS, uuid: () => "req-fixed", ...over };
}

beforeEach(() => {
  vi.mocked(runRetrievalV2Turn).mockReset();
});

describe("orchestrator — agentic read lifecycle (Milestone A)", () => {
  it("flag ON routes to the agentic loop; V2 pipeline is NOT called", async () => {
    const runAgentic = vi.fn(async () => agenticSuccess());
    const res = await runIntelligenceTurn({ message: "what is happening across the agency?" }, deps({ runAgentic }));
    expect(res.ok).toBe(true);
    expect(runAgentic).toHaveBeenCalledTimes(1);
    expect(runRetrievalV2Turn).not.toHaveBeenCalled();
    if (res.ok) expect(res.assistantMessage).toContain("4 clients");
  });

  it("confidence is APP-OWNED from the loop (HIGH ⇒ level high), persisted too", async () => {
    const repo = makeRepo();
    const runAgentic = vi.fn(async () => agenticSuccess());
    const res = await runIntelligenceTurn({ message: "status" }, deps({ runAgentic, repo: repo.repo }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.uncertainty?.level).toBe("high");
    const ok = repo.persisted.find((p) => p.status === "ok")!;
    expect((ok.uncertainty as { level: string }).level).toBe("high");
  });

  it("a qualified loop outcome ⇒ medium with the deterministic basis", async () => {
    const runAgentic = vi.fn(async () => agenticSuccess({ confidence: "qualified", confidenceBasis: "a read could not be completed" }));
    const res = await runIntelligenceTurn({ message: "status" }, deps({ runAgentic }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.uncertainty?.level).toBe("medium");
      expect(res.uncertainty?.notes).toContain("could not be completed");
    }
  });

  it("attaches the SAFE agentic trace to provenance (no raw content)", async () => {
    const repo = makeRepo();
    const runAgentic = vi.fn(async () => agenticSuccess());
    await runIntelligenceTurn({ message: "status" }, deps({ runAgentic, repo: repo.repo }));
    const ok = repo.persisted.find((p) => p.status === "ok")!;
    const prov = ok.provenance as { contextKind: string; agentic?: AgenticTrace };
    expect(prov.contextKind).toBe("agency");
    expect(prov.agentic?.mode).toBe("agentic");
    expect(JSON.stringify(prov.agentic)).not.toContain("assistant_message");
  });

  it("a loop failure persists a SAFE error row and reports a safe reason", async () => {
    const repo = makeRepo();
    const runAgentic = vi.fn(async (): Promise<AgenticOutcome> => ({ ok: false, reason: "unavailable", trace: TRACE }));
    const res = await runIntelligenceTurn({ message: "status" }, deps({ runAgentic, repo: repo.repo }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("unavailable");
    const err = repo.persisted.find((p) => p.status === "error")!;
    expect(err.content).not.toContain("across the agency"); // generic safe failure copy
    expect((err.provenance as { agentic?: AgenticTrace }).agentic?.mode).toBe("agentic");
  });

  it("an invalid_response outcome maps to the safe invalid_response reason", async () => {
    const runAgentic = vi.fn(async (): Promise<AgenticOutcome> => ({ ok: false, reason: "invalid_response:no_emit", trace: TRACE }));
    const res = await runIntelligenceTurn({ message: "status" }, deps({ runAgentic }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("invalid_response");
  });

  it("flag OFF (agenticRead:false) uses the V2/V1 path, NOT the agentic loop", async () => {
    const runAgentic = vi.fn(async () => agenticSuccess());
    const runRetrieval = vi.fn(async () => ({ plan: { kind: "agency" } as ContextPlan, dataBlock: "B", trace: undefined as never, confidence: "high" as const, confidenceBasis: "x" }));
    // agenticRead:false forces the deterministic path; provide a V2 seam + a provider.
    const provider: LLMProvider = { id: "p", model: "m", complete: vi.fn(async () => ({ text: JSON.stringify({ assistant_message: "v2" }), providerId: "p", model: "m", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 })) };
    await runIntelligenceTurn({ message: "status" }, deps({ runAgentic, runRetrieval, provider, agenticRead: false }));
    expect(runAgentic).not.toHaveBeenCalled();
    expect(runRetrieval).toHaveBeenCalledTimes(1);
  });
});
