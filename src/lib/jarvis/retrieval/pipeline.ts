import "server-only";

import { createClient } from "@/lib/supabase/server";
import { listMemories } from "@/lib/jarvis/memory/reads";
import { redactIfSecret } from "@/lib/jarvis/memory/secrets";
import type { JarvisContext } from "@/lib/jarvis/identity";
import type { ContextPlan } from "@/lib/jarvis/intelligence/types";
import type { EntityResolution, EvidencePackage, RetrievalTrace, RetrieverContext } from "./types";
import { resolveClientFromList, type ClientLike } from "./resolve/match";
import { planQuery } from "./plan/query-planner";
import { assembleClientEvidence } from "./assemble/client-intelligence";
import { serializeEvidencePackage } from "./evidence/serialize";
import { retrieveClientDiscovery, type DiscoveryResult } from "./retrievers/discovery";
import { buildTrace } from "./observability/trace";

/**
 * Jarvis Retrieval V2 pipeline (server-only). The single seam the orchestrator
 * calls when JARVIS_RETRIEVAL_V2 is on: resolve → plan → retrieve → assemble →
 * evidence, mapped onto the EXISTING ContextPlan so the orchestrator's clarify
 * short-circuit, provider call, persistence and F1 bridges are reused unchanged.
 * Reads run under the caller's RLS identity; the model never chooses data or ids.
 */

const STRONG_REFERENT_RE = /\b(that|this|the)\s+client\b/i;
const WEAK_REFERENT_RE = /\b(them|they|their|it|those)\b/i;

/** Deterministic, APP-OWNED answer confidence. Computed here from retrieval outcome
 *  (never generated or reinterpreted by the model). `null` only on the clarify/unknown
 *  paths, which short-circuit before any provider call. */
export type RetrievalConfidence = "high" | "qualified";

export interface RetrievalV2Result {
  plan: ContextPlan;
  /** Provider DATA block; null for clarify/unresolved (handled by the orchestrator). */
  dataBlock: string | null;
  trace: RetrievalTrace;
  /** Deterministic confidence for THIS turn; the orchestrator renders this, not the
   *  model's self-reported uncertainty. null ⇒ no provider call (clarify/unknown). */
  confidence: RetrievalConfidence | null;
  /** Short deterministic basis string (shown with a qualified answer). */
  confidenceBasis: string | null;
}

export async function runRetrievalV2Turn(
  ctx: JarvisContext,
  message: string,
  thread: { lastClientId: string | null },
  requestId = ""
): Promise<RetrievalV2Result> {
  const startMs = Date.now();
  const supabase = await createClient();
  const rc: RetrieverContext = { ctx, supabase, now: () => new Date() };

  const { data: clientRows } = await supabase.from("clients").select("id, name, company");
  const clients: ClientLike[] = (clientRows ?? []).map((c) => ({
    id: c.id as string,
    name: (c.name as string | null) ?? "",
    company: (c.company as string | null) ?? null,
  }));
  let resolution: EntityResolution = resolveClientFromList(message, clients);

  // Referent: reuse the stored thread client on a pronoun when unresolved (re-authorized under RLS).
  if (resolution.status === "none" && thread.lastClientId && (STRONG_REFERENT_RE.test(message) || WEAK_REFERENT_RE.test(message))) {
    const still = clients.find((c) => c.id === thread.lastClientId);
    if (still) {
      resolution = {
        status: "one",
        kind: "client",
        entity: { kind: "client", id: still.id, canonicalName: still.name, matchedOn: "name", tier: "exact", confidence: 1 },
      };
    }
  }

  const plan = planQuery({ message, resolution });

  let contextPlan: ContextPlan;
  let dataBlock: string | null = null;
  let evidence: EvidencePackage | undefined;
  let confidence: RetrievalConfidence | null = null;
  let confidenceBasis: string | null = null;

  if (plan.mode === "broad" || plan.mode === "focused") {
    const subject = plan.subject!;
    contextPlan = { kind: "client", clientId: subject.id, clientName: subject.name };
    evidence = await assembleClientEvidence(plan, rc);
    dataBlock = serializeEvidencePackage(evidence, rc.now());
    // App-owned confidence IS the assembler's deterministic answerConfidence.
    confidence = evidence.answerConfidence;
    confidenceBasis = evidence.confidenceBasis;
  } else if (plan.intent === "clarify") {
    contextPlan = { kind: "ambiguous_client", candidates: (plan.clarify?.candidates ?? []).map((c) => ({ id: c.id, name: c.canonicalName })) };
  } else if (plan.intent === "unresolved") {
    // Zero credible matches ⇒ NOT found (distinct from ambiguous). Carry the
    // referenced name so the turn says exactly what it couldn't find.
    contextPlan = { kind: "unknown_client", query: referencedName(message) };
  } else if (plan.mode === "discovery") {
    contextPlan = { kind: "agency" };
    const d = await retrieveClientDiscovery(rc);
    dataBlock = serializeDiscoveryBlock(d);
    ({ confidence, confidenceBasis } = discoveryConfidence(d.status));
  } else {
    // agency_fallback OR an unsupported FUTURE intent (graceful, agency-scoped).
    const unsupportedIntent = plan.supported ? null : plan.intent;
    contextPlan = { kind: "agency" };
    dataBlock = await buildAgencyBlock(rc, unsupportedIntent);
    ({ confidence, confidenceBasis } = agencyConfidence(unsupportedIntent));
  }

  const trace = buildTrace({
    requestId,
    resolution,
    plan,
    evidence,
    history: { turnsIncluded: 0, estTokens: 0, reducedFromTarget: false },
    promptInputEstTokens: 0,
    totalMs: Date.now() - startMs,
  });

  return { plan: contextPlan, dataBlock, trace, confidence, confidenceBasis };
}

/** Deterministic confidence for client discovery. A COMPLETE authorized list (ok or
 *  legitimately empty) is HIGH — truncation is coverage (disclosed in the block), not a
 *  confidence degrader. Only a genuine retrieval FAILURE qualifies the answer. */
export function discoveryConfidence(
  status: DiscoveryResult["status"]
): { confidence: RetrievalConfidence; confidenceBasis: string } {
  if (status === "error") {
    return {
      confidence: "qualified",
      confidenceBasis: "The client directory could NOT be retrieved this turn; do not assert the list is complete or empty.",
    };
  }
  return {
    confidence: "high",
    confidenceBasis: "The authorized client directory was retrieved in full (counts/grouping are deterministic). Any 'showing N of M' is coverage, not lower confidence.",
  };
}

/** Deterministic confidence for the agency-scope fallback. An unsupported (not-yet-enabled)
 *  intent is QUALIFIED; a plain agency answer from retrieved counts is HIGH. */
export function agencyConfidence(
  unsupportedIntent: string | null
): { confidence: RetrievalConfidence; confidenceBasis: string } {
  return unsupportedIntent
    ? {
        confidence: "qualified",
        confidenceBasis: `The requested capability (${unsupportedIntent}) is not enabled in this version; only agency-level data supports this answer.`,
      }
    : {
        confidence: "high",
        confidenceBasis: "Answered from authoritative agency-level Portal data.",
      };
}

/** Extract the capitalized proper-noun phrase the user referred to (for a not-found
 *  message). Mirrors the planner's client-reference cue; falls back to null. */
function referencedName(originalMessage: string): string | undefined {
  const m = originalMessage.match(
    /\b(?:with|about|on|for|regarding|re)\s+([A-Z][A-Za-z0-9&'-]+(?:\s+[A-Z&][A-Za-z0-9&'-]+){0,4})/
  );
  return m ? m[1].trim() : undefined;
}

/** Serialize an already-retrieved discovery result into the provider DATA block.
 *  PURE (no I/O) so retrieval and serialization are independently testable. */
function serializeDiscoveryBlock(d: DiscoveryResult): string {
  const lines = [
    "# client directory",
    "## AUTHORITATIVE PORTAL FACTS (source of operational truth)",
    // Deterministic, code-computed counts — the model MUST present these numbers
    // exactly and MUST NOT recount or regroup the rows itself.
    `### Clients — ${d.total} total${d.truncated ? ` (showing ${d.shown})` : ""}`,
  ];
  if (d.status === "error") {
    lines.push("- could not be retrieved this turn (do not assume none).");
    return lines.join("\n");
  }
  if (d.shown === 0) {
    lines.push("- none on file.");
    return lines.join("\n");
  }
  for (const g of d.groups) {
    lines.push(`#### ${redactIfSecret(g.status)} (${g.count})`);
    for (const c of g.clients) lines.push(`- ${redactIfSecret(c.name)}`);
  }
  if (d.truncated) lines.push(`- coverage: showing ${d.shown} of ${d.total} clients; narrow by status or service to see more.`);
  return lines.join("\n");
}

async function buildAgencyBlock(rc: RetrieverContext, unsupportedIntent: string | null): Promise<string> {
  const { count } = await rc.supabase.from("clients").select("id", { count: "exact", head: true });
  const mem = await listMemories({ scope: "agency", currentOnly: true, limit: 20 });
  const lines = ["# scope: agency", "## AUTHORITATIVE PORTAL FACTS (source of operational truth)", "### Agency", `- Clients: ${count ?? 0}`];
  if (unsupportedIntent) lines.push(`- note: the requested capability (${unsupportedIntent}) is not enabled in this version; answer only what agency-level data supports and say so.`);
  if (mem.length > 0) {
    lines.push("## DURABLE MEMORY (supplementary — NOT authoritative Portal truth)");
    for (const m of mem.slice(0, 20)) lines.push(`- (${m.category}) ${redactIfSecret(m.claim)}`);
  }
  return lines.join("\n");
}
