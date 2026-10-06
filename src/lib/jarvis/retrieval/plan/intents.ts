import type { DomainKey, SubdomainFocus } from "../types";

/**
 * Jarvis Retrieval V2 — pure intent detection tables and helpers for the planner.
 * Deterministic regex/keyword heuristics only; no LLM, no I/O.
 */

export const DISCOVERY_RE =
  /\bwho\s+are\s+(all\s+)?(our|the)\s+clients?\b|\blist\s+(all\s+)?(our\s+|the\s+)?clients?\b|\bhow\s+many\s+clients?\b|\ball\s+(our|the)\s+clients?\b/i;

const MEMORY_DECISION_RE = /\bdecided?\b|\bdecision\b|\bpromised?\b|\bagreed?\b|\bcommit(?:ment|ted)?\b/i;

const FOCUS_RES: Array<{ focus: SubdomainFocus; re: RegExp }> = [
  { focus: "financial", re: /\binvoices?\b|\bpayments?\b|\bpaid\b|\bowe|owing\b|\bfinanc\w*\b|\bbilling\b|\bretainers?\b|\boutstanding\b|\bbalance\b/i },
  { focus: "reports", re: /\breports?\b/i },
  { focus: "files", re: /\bfiles?\b|\bdocuments?\b|\bassets?\b/i },
  { focus: "onboarding", re: /\bonboard\w*\b/i },
  { focus: "questions", re: /\bquestions?\b|\bfollow[-\s]?ups?\b/i },
  { focus: "contact", re: /\bcontact\b|\bphone\b|\bemail\s+address\b/i },
  { focus: "tasks", re: /\btasks?\b|\boutstanding\b|\bto[-\s]?dos?\b|\bworking\s+on\b/i },
  { focus: "updates", re: /\bupdates?\b/i },
];

const FUTURE_RES = {
  multi_client_compare: /\bcompare\b|\bversus\b|\bvs\.?\b/i,
  person_workload: /\bwhat\s+(is|'?s)\s+\w+\s+working\s+on\b|\bwhat\s+am\s+i\s+working\s+on\b|\bmy\s+plate\b/i,
  timeline_change: /\bwhat('?s| is| has)\s+changed\b|\bchanged\s+(today|this\s+week|this\s+month)\b|\bwhat\s+happened\s+(today|this\s+week)\b/i,
  agency_overview: /\bacross\s+bbettr\b|\bacross\s+the\s+(agency|business)\b|\bneeds?\s+attention\b|\bwhole\s+(agency|business)\b|\bwhat('?s| is)\s+happening\s+across\b/i,
} as const;

/** Focus keywords present (order-stable, deduped). */
export function detectFocus(message: string): SubdomainFocus[] {
  const out: SubdomainFocus[] = [];
  for (const { focus, re } of FOCUS_RES) if (re.test(message) && !out.includes(focus)) out.push(focus);
  return out;
}

export function isMemoryDecision(message: string): boolean {
  return MEMORY_DECISION_RE.test(message);
}

export function isDiscovery(message: string): boolean {
  return DISCOVERY_RE.test(message);
}

export type FutureIntent = keyof typeof FUTURE_RES;
export function detectFuture(message: string): FutureIntent | null {
  for (const key of Object.keys(FUTURE_RES) as FutureIntent[]) if (FUTURE_RES[key].test(message)) return key;
  return null;
}

/**
 * Heuristic: does the message NAME a specific subject (a capitalized proper-noun
 * phrase after a reference preposition)? Used only to distinguish "asked about a
 * client we couldn't find" (→ unresolved) from a generic agency question.
 * Operates on ORIGINAL casing.
 */
export function hasClientReferenceCue(originalMessage: string): boolean {
  if (/\b(that|this|the)\s+client\b/i.test(originalMessage)) return true;
  const m = originalMessage.match(
    /\b(?:with|about|on|for|regarding|re)\s+([A-Z][A-Za-z0-9&'-]+(?:\s+[A-Z&][A-Za-z0-9&'-]+){0,4})/
  );
  return !!m;
}

/** Focus → the domains whose DETAIL should be deepened for a focused query. */
export const FOCUS_DOMAINS: Record<SubdomainFocus, DomainKey[]> = {
  tasks: ["tasks"],
  reports: ["reports"],
  files: ["files"],
  financial: ["invoices", "payments", "retainers", "billing_details"],
  onboarding: ["onboarding", "client_services"],
  updates: ["updates"],
  questions: ["update_questions", "updates"],
  contact: ["people", "client_identity"],
};

/** The fixed compact supporting mini-summary set for a focused query. */
export const FOCUSED_SUPPORT_SUMMARY: DomainKey[] = [
  "client_identity",
  "client_services",
  "project_stages",
  "updates",
  "tasks",
];
