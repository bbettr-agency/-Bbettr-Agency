import type { DomainKey, EvidencePackage, RetrievalPlan, RetrievalTrace, EntityResolution } from "../types";

/**
 * Jarvis Retrieval V2 — SAFE observability trace (PURE). Carries only counts / ids
 * / statuses / sizes — never fact values, claims, names of free-text, or secrets —
 * so it can be persisted to provenance and logged for debugging (e.g. "why did
 * A&S fail?") without leaking content. The resolved client id is an internal id
 * (provenance/logs only), never rendered to the provider.
 */
export function buildTrace(args: {
  requestId: string;
  resolution: EntityResolution;
  plan: RetrievalPlan;
  evidence?: EvidencePackage;
  history: { turnsIncluded: number; estTokens: number; reducedFromTarget: boolean };
  promptInputEstTokens: number;
  totalMs: number;
}): RetrievalTrace {
  const { plan, evidence } = args;
  const resolution =
    args.resolution.status === "one"
      ? { status: "one" as const, tier: args.resolution.entity.tier, resolvedClientId: args.resolution.entity.id }
      : args.resolution.status === "many"
        ? { status: "many" as const, candidateCount: args.resolution.candidates.length }
        : { status: "none" as const };

  const passADomains = plan.passA.map((i) => i.domain).filter((d) => d !== "memory");
  const detailed: DomainKey[] = [];
  const retrievers: RetrievalTrace["retrievers"] = [];
  if (evidence) {
    for (const de of [...evidence.portalAuthoritative, ...evidence.memory]) {
      if (de.phase === "detail") detailed.push(de.domain);
      retrievers.push({
        domain: de.domain,
        phase: de.phase,
        status: de.status,
        returned: de.returnedCount,
        available: de.availableCount,
        truncated: de.truncated,
        tookMs: 0,
      });
    }
  }

  return {
    requestId: args.requestId,
    mode: plan.mode,
    intent: plan.intent,
    resolution,
    passA: { domainsCovered: passADomains, estTokens: 0 },
    passB: {
      domainsDetailed: detailed,
      domainsDetailOmitted: evidence?.budget.droppedDomains ?? [],
      estTokens: 0,
    },
    memory: { count: evidence?.memory[0]?.returnedCount ?? 0, estTokens: 0 },
    retrievers,
    evidence: {
      estTokensTotal: evidence?.budget.estimatedTokens ?? 0,
      evidenceCeilingHit:
        !!evidence && evidence.budget.totalBudgetTokens > 0 && evidence.budget.estimatedTokens >= evidence.budget.totalBudgetTokens,
    },
    history: {
      turnsIncluded: args.history.turnsIncluded,
      estTokens: args.history.estTokens,
      reducedFromTarget: args.history.reducedFromTarget,
    },
    promptInputEstTokens: args.promptInputEstTokens,
    totalMs: args.totalMs,
  };
}
