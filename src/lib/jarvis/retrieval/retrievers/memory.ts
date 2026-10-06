import "server-only";

import { listMemories } from "@/lib/jarvis/memory/reads";
import { redactIfSecret } from "@/lib/jarvis/memory/secrets";
import type { RetrieverDescriptor, RetrieverContext, RetrieverInput, EvidenceFact } from "../types";
import { fact, freshest, result, timed } from "./helpers";

/**
 * Memory retriever (Class 2 — SUPPLEMENTARY, kept separate from Portal truth).
 * Reads current client-scoped + relevant agency memory under the caller's RLS via
 * the existing structured memory read layer (no FTS/embeddings). Claims are
 * secret-scanned at the provider boundary; here we also scan previews.
 */

const MEM = "memory" as const;

async function memoryFacts(input: RetrieverInput, rc: RetrieverContext, startMs: number, limit: number) {
  const e = input.entity;
  const [clientMem, agencyMem] = await Promise.all([
    listMemories({ scope: "client", clientId: e.id, currentOnly: true, limit }),
    listMemories({ scope: "agency", currentOnly: true, limit }),
  ]);
  const all = [...clientMem, ...agencyMem].sort((a, b) => b.importance - a.importance || b.observedAt.localeCompare(a.observedAt));
  const shown = all.slice(0, limit);
  const facts: EvidenceFact[] = shown.map((m) =>
    fact("memory", MEM, e, `(${m.category}) ${m.scope}`, redactIfSecret(m.claim), "jarvis_memories", { occurredAt: m.observedAt, recordRef: `jarvis_memories:${m.id}` })
  );
  return result("memory", MEM, facts, {
    returned: shown.length,
    available: all.length,
    freshestAt: freshest(shown.map((m) => m.observedAt)),
    tookMs: rc.now().getTime() - startMs,
  });
}

export const memoryRetriever: RetrieverDescriptor = {
  domain: "memory",
  authority: MEM,
  authorization: "rls_principal",
  runSummary: (i, rc) => timed("memory", MEM, rc.now, (s) => memoryFacts(i, rc, s, 5)),
  runDetail: (i, rc) => timed("memory", MEM, rc.now, (s) => memoryFacts(i, rc, s, i.detailLimit ?? 20)),
};
