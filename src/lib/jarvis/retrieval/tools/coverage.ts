/**
 * Jarvis coverage model — the EXTENSIBLE domain contract behind coverage-aware
 * reliability. It separates three things the reliability calculation needs:
 *   1. retrieval success  — did a tool execute ok (tracked in the loop);
 *   2. source coverage    — which authoritative domains were actually checked
 *                           (each read tool declares what it `provides`);
 *   3. question coverage  — are those domains sufficient for the user's question
 *                           (a deterministic breadth signal + the known universe).
 *
 * The universe below is CODE-OWNED and grows as Portal/connector domains are wired:
 * add a domain here (supported:false until a tool exists), set a tool's `provides`,
 * and broad-question coverage automatically accounts for it. Nothing here hardcodes a
 * "complete" guarantee — a broad answer stays PARTIAL while ANY relevant agency domain
 * is unsupported or unchecked.
 */

export type CoverageKey =
  // currently supported (a read tool exists)
  | "tasks_today"
  | "clients"
  | "onboarding"
  | "invoices"
  | "client_updates"
  | "project_stages"
  | "client_profile"
  // known but NOT YET SUPPORTED (no tool wired — future milestones/connectors)
  | "meetings"
  | "notifications"
  | "team_workload"
  | "finance"
  | "client_communications"
  | "leads_opportunities"
  | "recurring_reminders";

export interface CoverageDomain {
  key: CoverageKey;
  label: string;
  /** Agency-wide signal relevant to a broad "state of the business" assessment. */
  agencyRelevant: boolean;
  /** A read tool exists for it today (false ⇒ Jarvis cannot check it yet). */
  supported: boolean;
}

/** The known coverage universe. EXTEND THIS as domains/connectors are added. */
export const COVERAGE_DOMAINS: readonly CoverageDomain[] = [
  { key: "tasks_today", label: "Planner tasks (today)", agencyRelevant: true, supported: true },
  { key: "clients", label: "Client directory", agencyRelevant: true, supported: true },
  { key: "onboarding", label: "Onboarding status", agencyRelevant: true, supported: true },
  { key: "invoices", label: "Unpaid invoices", agencyRelevant: true, supported: true },
  { key: "client_updates", label: "Client update recency", agencyRelevant: true, supported: true },
  { key: "project_stages", label: "Project stages", agencyRelevant: true, supported: true },
  { key: "client_profile", label: "Single-client profile", agencyRelevant: false, supported: true },
  // Not yet built — their presence keeps a broad business assessment honestly PARTIAL:
  { key: "meetings", label: "Meetings / calendar", agencyRelevant: true, supported: false },
  { key: "notifications", label: "Notifications", agencyRelevant: true, supported: false },
  { key: "team_workload", label: "Team workload", agencyRelevant: true, supported: false },
  { key: "finance", label: "Finance (QuickBooks/PayFast)", agencyRelevant: true, supported: false },
  { key: "client_communications", label: "Client communications (email/WhatsApp)", agencyRelevant: true, supported: false },
  { key: "leads_opportunities", label: "Leads & opportunities (GHL)", agencyRelevant: true, supported: false },
  { key: "recurring_reminders", label: "Recurring reminders (full)", agencyRelevant: true, supported: false },
];

export const AGENCY_RELEVANT_KEYS: readonly CoverageKey[] = COVERAGE_DOMAINS.filter((d) => d.agencyRelevant).map((d) => d.key);
export const SUPPORTED_AGENCY_KEYS: readonly CoverageKey[] = COVERAGE_DOMAINS.filter((d) => d.agencyRelevant && d.supported).map((d) => d.key);
export const UNSUPPORTED_AGENCY_KEYS: readonly CoverageKey[] = COVERAGE_DOMAINS.filter((d) => d.agencyRelevant && !d.supported).map((d) => d.key);

export function labelFor(key: CoverageKey): string {
  return COVERAGE_DOMAINS.find((d) => d.key === key)?.label ?? key;
}

/**
 * Is a BROAD agency-wide assessment fully covered by what was checked? True only when
 * EVERY agency-relevant SUPPORTED domain was checked AND there are NO agency-relevant
 * UNSUPPORTED domains outstanding. While any relevant domain is unsupported (current
 * milestone), this is always false — a broad answer can never be "verified" yet.
 */
export function broadCoverageComplete(checked: ReadonlySet<CoverageKey>): boolean {
  if (UNSUPPORTED_AGENCY_KEYS.length > 0) return false;
  return SUPPORTED_AGENCY_KEYS.every((k) => checked.has(k));
}

/** The important areas a broad answer did NOT examine (unchecked supported + all
 *  unsupported agency domains), as human labels — surfaced in the answer. */
export function unexaminedAgencyAreas(checked: ReadonlySet<CoverageKey>): string[] {
  const out: string[] = [];
  for (const k of SUPPORTED_AGENCY_KEYS) if (!checked.has(k)) out.push(labelFor(k));
  for (const k of UNSUPPORTED_AGENCY_KEYS) out.push(labelFor(k));
  return out;
}

// ── Deterministic question-breadth classifier (question coverage axis) ───────────
// Broad = a whole-business / cross-client / "needs attention" / "which clients" style
// question that implies surveying many domains. Narrow = a single subject/domain (a
// named client, "my planner today", a specific metric). Pure, code-owned; it NEVER
// chooses data (the model still picks tools) — it only sets how much coverage a
// confident answer requires. Default is narrow so we do NOT downgrade indiscriminately.
const BROAD_PATTERNS: readonly RegExp[] = [
  /\bneeds?\s+(my\s+|your\s+|our\s+)?attention\b/i,
  /\bacross\s+(the\s+)?(agency|business|bbettr|board|company)\b/i,
  /\bwhat('?s| is)\s+happening\s+across\b/i,
  /\bis\s+everything\s+(ok|okay|alright|fine|good)\b/i,
  /\beverything\s+(ok|okay|alright|fine)\b/i,
  /\bwhich\s+clients?\b/i,
  /\ball\s+(my\s+|our\s+)?clients?\b/i,
  /\boverall\b/i,
  /\bwhole\s+(business|agency|company)\b/i,
  /\banything\s+i\s+should\s+know\b/i,
  /\bhow('?s| is|'re| are)\s+(things|we|the\s+(business|agency))\b/i,
  /\bstate\s+of\s+(the\s+)?(business|agency)\b/i,
];

export type QuestionBreadth = "broad" | "narrow";

export function classifyQuestionBreadth(message: string): QuestionBreadth {
  const m = message ?? "";
  return BROAD_PATTERNS.some((re) => re.test(m)) ? "broad" : "narrow";
}

// A question may explicitly ask about a domain Jarvis cannot YET fully check (e.g.
// recurring reminders, meetings, finance). Such a question can never be "verified" —
// we don't have the authoritative full source. Patterns are conservative/specific to
// avoid flagging supported slices (e.g. "unpaid invoices" is supported and NOT finance).
const UNSUPPORTED_QUESTION_PATTERNS: ReadonlyArray<{ key: CoverageKey; re: RegExp }> = [
  { key: "recurring_reminders", re: /\brecurring\b|\breminders?\b/i },
  { key: "meetings", re: /\bmeetings?\b|\bcalendar\b/i },
  { key: "finance", re: /\bquickbooks\b|\bprofit\b|\bcash\s*flow\b|\brevenue\b/i },
  { key: "client_communications", re: /\bemails?\b|\bwhatsapp\b|\bmessages?\s+(from|to|with)\b/i },
  { key: "leads_opportunities", re: /\bleads?\b|\bopportunit(y|ies)\b|\bpipeline\b|\bgohighlevel\b|\bghl\b/i },
  { key: "team_workload", re: /\bteam\s+(workload|capacity)\b|\bwho('?s| is)\s+working\s+on\b/i },
];

const UNSUPPORTED_KEYS = new Set<CoverageKey>(COVERAGE_DOMAINS.filter((d) => !d.supported).map((d) => d.key));

/** Unsupported domains the QUESTION explicitly asks about (so a confident answer is
 *  impossible — Jarvis lacks the authoritative source). Returns their keys. */
export function questionUnsupportedDomains(message: string): CoverageKey[] {
  const m = message ?? "";
  return UNSUPPORTED_QUESTION_PATTERNS.filter((p) => UNSUPPORTED_KEYS.has(p.key) && p.re.test(m)).map((p) => p.key);
}
