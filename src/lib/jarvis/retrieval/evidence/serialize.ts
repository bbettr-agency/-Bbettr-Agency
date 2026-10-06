import { redactIfSecret } from "@/lib/jarvis/memory/secrets";
import type { DomainKey, DomainEvidence, EvidenceFact, EvidencePackage, RetrieverStatus } from "../types";
import type { FinancialSummary } from "../financial";

/**
 * Jarvis Retrieval V2 — evidence → provider DATA block serialization.
 *
 * MANDATORY secret re-scan: EVERY rendered string value passes through
 * redactIfSecret at this provider boundary (defence-in-depth on top of retriever
 * scanning). Internal recordRef / DB ids are NEVER rendered. Portal authoritative
 * truth is kept visually separate from supplementary Memory. Failure states
 * (empty / error / denied / unavailable / truncated / stale) render distinctly so
 * the model never turns "not retrieved" into "doesn't exist". The bounded financial
 * aggregate renders exact vs partial/lower-bound semantics.
 */

const CLIP = 300;

function clip(s: string, n = CLIP): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** Scan + clip a scalar for provider output. */
function scalar(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(none)";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return clip(redactIfSecret(s));
}

function isFinancialSummary(v: unknown): v is FinancialSummary {
  return !!v && typeof v === "object" && "basis" in v && "unpaidCount" in v;
}

function financialLine(f: FinancialSummary): string {
  const cur = f.currency && f.currency !== "mixed" ? `${f.currency} ` : f.currency === "mixed" ? "(mixed currencies) " : "";
  if (f.exact) {
    return `${f.unpaidCount} unpaid invoice(s), totalling ${cur}${f.amountRetrieved} (exact total)`;
  }
  return `${f.unpaidCount} unpaid invoice(s); ${cur}${f.amountRetrieved} summed from ${f.rowsCounted} of ${f.unpaidCount} retrieved (PARTIAL — lower bound, NOT the exact total outstanding)`;
}

function renderValue(v: unknown): string {
  if (isFinancialSummary(v)) return financialLine(v);
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const parts: string[] = [];
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === null || val === undefined) continue;
      parts.push(`${k}=${scalar(val)}`);
    }
    return parts.join(", ");
  }
  return scalar(v);
}

function renderFact(f: EvidenceFact): string {
  return `- ${clip(redactIfSecret(f.label), 120)}: ${renderValue(f.value)}`;
}

const DOMAIN_LABEL: Record<DomainKey, string> = {
  client_identity: "Client",
  client_services: "Services",
  project_stages: "Project stages",
  onboarding: "Onboarding",
  updates: "Updates",
  tasks: "Tasks",
  reports: "Reports",
  contracts: "Contracts",
  invoices: "Invoices / outstanding",
  payments: "Payments",
  retainers: "Retainers",
  activity: "Activity",
  weekly_updates: "Weekly updates",
  deals: "Deal / pipeline",
  files: "Files (metadata)",
  memory: "Memory",
  billing_details: "Billing details",
  update_questions: "Client questions",
  people: "People / contact",
};

function statusNote(status: RetrieverStatus): string | null {
  switch (status) {
    case "empty":
      return "none on file.";
    case "error":
      return "could not be retrieved this turn (do not assume none).";
    case "denied":
      return "not accessible under your permissions.";
    case "unavailable":
      return "integration not available.";
    default:
      return null;
  }
}

/** How old (days) before a domain's freshest item is flagged stale. */
const STALE_DAYS: Partial<Record<DomainKey, number>> = { updates: 30, reports: 45, activity: 30 };

function staleNote(de: DomainEvidence, now: Date): string | null {
  const days = STALE_DAYS[de.domain];
  if (!days || !de.freshestAt) return null;
  const ageMs = now.getTime() - new Date(de.freshestAt).getTime();
  if (ageMs > days * 86_400_000) {
    return `most recent item is ${Math.floor(ageMs / 86_400_000)} days old (${de.freshestAt.slice(0, 10)}).`;
  }
  return null;
}

export function serializeDomainEvidence(de: DomainEvidence, now: Date): string {
  const lines: string[] = [`### ${DOMAIN_LABEL[de.domain]}`];
  const note = statusNote(de.status);
  if (note) {
    lines.push(`- ${note}`);
    return lines.join("\n");
  }
  for (const f of de.facts) lines.push(renderFact(f));
  if (de.truncated && de.availableCount != null) {
    lines.push(`- (showing ${de.returnedCount} of ${de.availableCount})`);
  }
  const stale = staleNote(de, now);
  if (stale) lines.push(`- note: ${stale}`);
  return lines.join("\n");
}

export function serializeEvidencePackage(pkg: EvidencePackage, now: Date = new Date()): string {
  const lines: string[] = [];
  lines.push(`# subject: ${pkg.subject ? clip(redactIfSecret(pkg.subject.name), 80) : pkg.mode}`);
  lines.push("## AUTHORITATIVE PORTAL FACTS (source of operational truth)");
  for (const de of pkg.portalAuthoritative) lines.push(serializeDomainEvidence(de, now));
  if (pkg.memory.length > 0) {
    lines.push("## DURABLE MEMORY (supplementary — NOT authoritative Portal truth)");
    for (const de of pkg.memory) lines.push(serializeDomainEvidence(de, now));
  }
  return lines.join("\n");
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
