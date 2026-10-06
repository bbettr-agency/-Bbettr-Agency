import { describe, it, expect, beforeEach, vi } from "vitest";

// Flags: this suite drives the Retrieval V2 path, so default V2 ON (overridable).
vi.mock("@/lib/flags", () => ({
  isJarvisEnabled: vi.fn(() => true),
  isJarvisIntelligenceEnabled: vi.fn(() => true),
  isJarvisRetrievalV2Enabled: vi.fn(() => true),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ id: "admin1", role: "admin" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
// The real pipeline would hit the DB; mock it so flag-ON (no seam) routes here.
vi.mock("@/lib/jarvis/retrieval/pipeline", () => ({ runRetrievalV2Turn: vi.fn() }));

import { runIntelligenceTurn, type TurnDeps, type ContextAssembler } from "./orchestrator";
import { runRetrievalV2Turn } from "@/lib/jarvis/retrieval/pipeline";
import { isJarvisRetrievalV2Enabled } from "@/lib/flags";
import type { ConversationRepo, ConversationThread, AssistantRow } from "./repository";
import type { ContextPlan } from "./types";
import type { JarvisContext } from "@/lib/jarvis/identity";
import type { IntelligenceLimits } from "@/lib/jarvis/llm/limits";
import type { LLMProvider, LLMCompletionRequest, LLMCompletionResult } from "@/lib/jarvis/llm/provider";
import type { RetrievalTrace } from "@/lib/jarvis/retrieval/types";
import type { ContextPackage } from "@/lib/jarvis/memory/context-shape";

const CTX: JarvisContext = { principalId: "u1", workspaceId: "w1", grants: new Set(["jarvis.use"]) };
const LIMITS: IntelligenceLimits = { historyTurns: 10, maxOutputTokens: 1200, timeoutMs: 30_000, maxProviderCallsPerTurn: 1, maxTransientRetries: 1 };
const OK_TEXT = JSON.stringify({ assistant_message: "Here is your answer." });

const TRACE: RetrievalTrace = {
  requestId: "req-fixed",
  mode: "broad",
  intent: "client_detail",
  resolution: { status: "one", tier: "exact", resolvedClientId: "c1" },
  passA: { domainsCovered: ["client_identity"], estTokens: 0 },
  passB: { domainsDetailed: ["updates"], domainsDetailOmitted: ["files"], estTokens: 0 },
  memory: { count: 2, estTokens: 0 },
  retrievers: [{ domain: "updates", phase: "detail", status: "ok", returned: 3, available: 5, truncated: true, tookMs: 1 }],
  evidence: { estTokensTotal: 1200, evidenceCeilingHit: false },
  history: { turnsIncluded: 0, estTokens: 0, reducedFromTarget: false },
  promptInputEstTokens: 0,
  totalMs: 2,
};

function makeProvider() {
  const seen = { request: undefined as LLMCompletionRequest | undefined, calls: 0 };
  const provider: LLMProvider = {
    id: "mockP",
    model: "mockM",
    complete: vi.fn(async (req: LLMCompletionRequest): Promise<LLMCompletionResult> => {
      seen.request = req;
      seen.calls += 1;
      return { text: OK_TEXT, providerId: "trusted-provider", model: "trusted-model", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 };
    }),
  };
  return { provider, seen };
}

function makeRepo(history?: Array<{ id: string; role: "user" | "assistant"; content: string }>) {
  const persisted: Array<AssistantRow & { requestId: string }> = [];
  const order: string[] = [];
  const repo: ConversationRepo = {
    createThread: async (): Promise<ConversationThread> => ({ id: "t1", lastClientId: null }),
    loadAuthorizedThread: async (_c, id): Promise<ConversationThread | null> => ({ id, lastClientId: null }),
    persistUserMessage: async () => "umsg-1",
    loadBoundedHistory: async () => history ?? [{ id: "umsg-1", role: "user", content: "current" }],
    updateLastClientId: vi.fn(async () => { order.push("updateLastClientId"); }),
    persistAssistant: async (_c, _t, requestId: string, row: AssistantRow): Promise<string> => {
      persisted.push({ ...row, requestId });
      return "amsg-1";
    },
  };
  return { repo, persisted, order };
}

function emptyPkg(kind: ContextPackage["kind"]): ContextPackage {
  return {
    kind,
    subjectId: null,
    generatedAt: "2026-01-01T00:00:00Z",
    portal: { authoritative: true, sections: [] },
    memory: [],
    openCommitments: [],
    unresolvedConflicts: [],
    caps: { memory: 20, commitments: 15, conflicts: 15 },
    truncated: {},
  };
}
function makeAssembler() {
  return {
    agency: vi.fn(async () => emptyPkg("agency")),
    user: vi.fn(async () => emptyPkg("user")),
    client: vi.fn(async () => emptyPkg("client")),
  } satisfies ContextAssembler;
}

function deps(over: Partial<TurnDeps> = {}): TurnDeps {
  return {
    provider: makeProvider().provider,
    resolveContext: async () => CTX,
    repo: makeRepo().repo,
    router: async (): Promise<ContextPlan> => ({ kind: "agency" }),
    assembler: makeAssembler(),
    limits: LIMITS,
    uuid: () => "req-fixed",
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(isJarvisRetrievalV2Enabled).mockReturnValue(true);
  vi.mocked(runRetrievalV2Turn).mockReset();
});

describe("orchestrator — Retrieval V2 integration", () => {
  it("flag ON (no seam) routes through the pipeline and feeds its DATA block to the provider; V1 assembler NOT called", async () => {
    vi.mocked(runRetrievalV2Turn).mockResolvedValue({ plan: { kind: "client", clientId: "c1", clientName: "A&S Wholesalers" }, dataBlock: "EVIDENCE-BLOCK-XYZ", trace: TRACE });
    const { provider, seen } = makeProvider();
    const assembler = makeAssembler();
    const repo = makeRepo();
    const res = await runIntelligenceTurn({ message: "What is happening with A&S Wholesalers?" }, deps({ provider, assembler, repo: repo.repo }));

    expect(res.ok).toBe(true);
    expect(runRetrievalV2Turn).toHaveBeenCalledTimes(1);
    expect(seen.request?.system).toContain("EVIDENCE-BLOCK-XYZ");
    expect(assembler.client).not.toHaveBeenCalled();
    expect(assembler.agency).not.toHaveBeenCalled();
    expect(repo.order).toContain("updateLastClientId"); // referent maintained for a resolved client
  });

  it("flag OFF → V1 path: pipeline NOT called, V1 assembler used, evidence block absent", async () => {
    vi.mocked(isJarvisRetrievalV2Enabled).mockReturnValue(false);
    const { provider, seen } = makeProvider();
    const assembler = makeAssembler();
    await runIntelligenceTurn({ message: "status please" }, deps({ provider, assembler, router: async () => ({ kind: "agency" }) }));

    expect(runRetrievalV2Turn).not.toHaveBeenCalled();
    expect(assembler.agency).toHaveBeenCalledTimes(1);
    expect(seen.request?.system).not.toContain("EVIDENCE-BLOCK-XYZ");
  });

  it("uses the injected deps.runRetrieval seam over the real pipeline", async () => {
    const seam = vi.fn(async () => ({ plan: { kind: "client", clientId: "c9", clientName: "Fine Art" } as ContextPlan, dataBlock: "SEAM-BLOCK", trace: TRACE }));
    const { provider, seen } = makeProvider();
    await runIntelligenceTurn({ message: "Fine Art overview" }, deps({ provider, runRetrieval: seam }));
    expect(seam).toHaveBeenCalledTimes(1);
    expect(runRetrievalV2Turn).not.toHaveBeenCalled();
    expect(seen.request?.system).toContain("SEAM-BLOCK");
  });

  it("ambiguous client (V2) → deterministic clarification, NO provider call", async () => {
    const seam = vi.fn(async () => ({ plan: { kind: "ambiguous_client", candidates: [{ id: "f1", name: "Fine Art Printers" }, { id: "f2", name: "Fine Art Studio" }] } as ContextPlan, dataBlock: null, trace: TRACE }));
    const { provider, seen } = makeProvider();
    const res = await runIntelligenceTurn({ message: "Fine Art" }, deps({ provider, runRetrieval: seam }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.clarification).toBe(true);
      expect(res.assistantMessage).toContain("Fine Art Printers");
      expect(res.assistantMessage).toContain("Fine Art Studio");
    }
    expect(seen.calls).toBe(0); // no provider call
  });

  it("unknown client (V2) → clarification, NO provider call, no data leaked", async () => {
    const seam = vi.fn(async () => ({ plan: { kind: "unknown_client" } as ContextPlan, dataBlock: null, trace: TRACE }));
    const { provider, seen } = makeProvider();
    const res = await runIntelligenceTurn({ message: "What about Globex?" }, deps({ provider, runRetrieval: seam }));
    expect((res as { clarification?: boolean }).clarification).toBe(true);
    expect(seen.calls).toBe(0);
  });

  it("attaches the V2 trace to persisted provenance (client plan)", async () => {
    const seam = vi.fn(async () => ({ plan: { kind: "client", clientId: "c1", clientName: "A&S" } as ContextPlan, dataBlock: "B", trace: TRACE }));
    const repo = makeRepo();
    await runIntelligenceTurn({ message: "A&S" }, deps({ runRetrieval: seam, repo: repo.repo }));
    const ok = repo.persisted.find((p) => p.status === "ok")!;
    const prov = ok.provenance as { contextKind: string; clientId: string | null; retrieval?: RetrievalTrace };
    expect(prov.contextKind).toBe("client");
    expect(prov.clientId).toBe("c1");
    expect(prov.retrieval?.intent).toBe("client_detail");
    // safe trace: no free-text fact values anywhere in the serialized provenance
    expect(JSON.stringify(prov.retrieval)).not.toContain("assistant_message");
  });

  it("history-fit: large evidence trims OLDEST replayed history but keeps the current message", async () => {
    const big = "x".repeat(4000);
    const history = [
      ...Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, role: "user" as const, content: big })),
      { id: "umsg-1", role: "user" as const, content: "CURRENT-MESSAGE" },
    ];
    const hugeBlock = "z".repeat(60000); // ~15k tokens → forces history down to the floor
    const seam = vi.fn(async () => ({ plan: { kind: "client", clientId: "c1", clientName: "A&S" } as ContextPlan, dataBlock: hugeBlock, trace: TRACE }));
    const { provider, seen } = makeProvider();
    await runIntelligenceTurn({ message: "A&S" }, deps({ provider, runRetrieval: seam, repo: makeRepo(history).repo }));
    const msgs = seen.request!.messages;
    expect(msgs.length).toBeLessThan(history.length); // oldest replayed dropped
    expect(msgs[msgs.length - 1].content).toBe("CURRENT-MESSAGE"); // current preserved
  });
});
