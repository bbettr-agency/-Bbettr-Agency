import "server-only";

import type {
  BudgetReport,
  DomainEvidence,
  DomainKey,
  EvidencePackage,
  RetrievalPlan,
  RetrieverContext,
  RetrieverDescriptor,
  RetrieverInput,
  RetrieverResult,
  RetrieverStatus,
} from "../types";
import { RETRIEVER_REGISTRY } from "../retrievers/registry";
import { DOMAIN_CONFIG } from "../domain-config";
import { serializeDomainEvidence, estimateTokens } from "../evidence/serialize";
import { BUDGET, detailBudgetRange } from "../evidence/budget";

/**
 * Client Intelligence assembler (server-only). Runs Pass-A summaries (guaranteed
 * coverage across every planned domain) and Pass-B details in parallel under RLS,
 * then allocates detail by priority within the evidence budget. Pass-A summaries
 * are never dropped for budget — only Pass-B detail is trimmed (lowest priority
 * first). Empty/error domains remain represented. Portal truth and Memory stay
 * separate. Partial-failure safe (one domain's failure never aborts the turn).
 */

function toEvidence(r: RetrieverResult, phase: "summary" | "detail"): DomainEvidence {
  return {
    domain: r.domain,
    authority: r.authority,
    status: r.status,
    phase,
    facts: r.facts,
    returnedCount: r.returnedCount,
    availableCount: r.availableCount,
    truncated: r.truncated,
    freshestAt: r.freshestAt,
  };
}

const est = (de: DomainEvidence, now: Date) => estimateTokens(serializeDomainEvidence(de, now));

/** Trim facts (from the end) until the domain fits `budget`, marking it truncated. */
function capFacts(de: DomainEvidence, budget: number, now: Date): DomainEvidence {
  if (est(de, now) <= budget || de.facts.length <= 1) return de;
  const facts = [...de.facts];
  while (facts.length > 1 && estimateTokens(serializeDomainEvidence({ ...de, facts }, now)) > budget) facts.pop();
  const dropped = facts.length < de.facts.length;
  return {
    ...de,
    facts,
    truncated: de.truncated || dropped,
    availableCount: de.availableCount ?? (dropped ? de.facts.length : de.returnedCount),
  };
}

interface Ran {
  domain: DomainKey;
  result: RetrieverResult;
}

async function runInvocations(
  invs: RetrievalPlan["passA"],
  input: RetrieverInput,
  rc: RetrieverContext,
  registry: ReadonlyMap<DomainKey, RetrieverDescriptor>
): Promise<Map<DomainKey, RetrieverResult>> {
  const settled = await Promise.allSettled(
    invs.map(async (inv): Promise<Ran | null> => {
      const desc = registry.get(inv.domain);
      if (!desc) return null;
      const res =
        inv.phase === "summary"
          ? await desc.runSummary(input, rc)
          : await desc.runDetail({ ...input, detailLimit: inv.detailLimit }, rc);
      return { domain: inv.domain, result: res };
    })
  );
  const map = new Map<DomainKey, RetrieverResult>();
  for (const s of settled) if (s.status === "fulfilled" && s.value) map.set(s.value.domain, s.value.result);
  return map;
}

export async function assembleClientEvidence(
  plan: RetrievalPlan,
  rc: RetrieverContext,
  registry: ReadonlyMap<DomainKey, RetrieverDescriptor> = RETRIEVER_REGISTRY
): Promise<EvidencePackage> {
  const now = rc.now();
  const subject = plan.subject!;
  const input: RetrieverInput = { entity: subject };

  const [summaryByDomain, detailByDomain] = await Promise.all([
    runInvocations(plan.passA, input, rc, registry),
    runInvocations(plan.passB, input, rc, registry),
  ]);

  // ── Memory (separate lane, capped) ─────────────────────────────────────────
  const memPick = detailByDomain.get("memory") ?? summaryByDomain.get("memory");
  let memoryEvidence: DomainEvidence[] = [];
  let memoryTokens = 0;
  if (memPick) {
    const de = capFacts(toEvidence(memPick, detailByDomain.has("memory") ? "detail" : "summary"), BUDGET.MEMORY_HARD, now);
    memoryEvidence = [de];
    memoryTokens = est(de, now);
  }

  // ── Pass A (guaranteed floor): every portal summary domain ─────────────────
  const evidenceByDomain = new Map<DomainKey, DomainEvidence>();
  for (const inv of plan.passA) {
    if (inv.domain === "memory") continue;
    const r = summaryByDomain.get(inv.domain);
    if (r) evidenceByDomain.set(inv.domain, toEvidence(r, "summary"));
  }
  const passATokens = [...evidenceByDomain.values()].reduce((s, de) => s + est(de, now), 0);

  // ── Pass B detail allocation by priority within budget ─────────────────────
  const { target, hard } = detailBudgetRange(passATokens, memoryTokens);
  const droppedDomains: DomainKey[] = [];
  let detailSpent = 0;
  const passBPortal = plan.passB.filter((i) => i.domain !== "memory").sort((a, b) => a.priority - b.priority);
  for (const inv of passBPortal) {
    const dres = detailByDomain.get(inv.domain);
    if (!dres) continue;
    const detailDe = toEvidence(dres, "detail");
    const detailTok = est(detailDe, now);
    const summaryDe = evidenceByDomain.get(inv.domain);
    if (summaryDe) {
      const marginal = Math.max(0, detailTok - est(summaryDe, now));
      if (detailSpent + marginal <= hard) {
        evidenceByDomain.set(inv.domain, detailDe);
        detailSpent += marginal;
      } else {
        droppedDomains.push(inv.domain); // keep the Pass-A summary
      }
    } else {
      // Focus / identity domain with no Pass-A summary — high priority, include it.
      if (detailSpent + detailTok <= hard || inv.priority <= 1) {
        evidenceByDomain.set(inv.domain, detailDe);
        detailSpent += detailTok;
      } else {
        droppedDomains.push(inv.domain);
      }
    }
  }

  // Deterministic ordering by configured priority.
  const portalAuthoritative = [...evidenceByDomain.values()].sort(
    (a, b) => DOMAIN_CONFIG[a.domain].priority - DOMAIN_CONFIG[b.domain].priority
  );

  const domainStatus: Record<string, RetrieverStatus> = {};
  for (const de of [...portalAuthoritative, ...memoryEvidence]) domainStatus[de.domain] = de.status;

  const estimatedTokens = portalAuthoritative.reduce((s, de) => s + est(de, now), 0) + memoryTokens;
  const budget: BudgetReport = {
    totalBudgetTokens: BUDGET.EVIDENCE_HARD,
    estimatedTokens,
    droppedDomains,
    clippedDomains: passATokens > BUDGET.PASS_A_CAP ? portalAuthoritative.map((d) => d.domain) : [],
  };

  return {
    generatedAt: now.toISOString(),
    intent: plan.intent,
    mode: plan.mode,
    subject,
    portalAuthoritative,
    memory: memoryEvidence,
    domainStatus,
    budget,
  };
}
