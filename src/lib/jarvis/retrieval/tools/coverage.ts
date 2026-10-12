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

// ── Granular coverage contributions (level + scope) ──────────────────────────────
// A contribution is emitted ONLY by a SUCCESSFUL tool result and records what was
// actually checked:
//   • level  — "full" (authoritative source read for the stated scope) or "signal"
//              (a count / aggregate / partial slice);
//   • scope  — breadth of the read: "agency" (across the workspace), "viewer" (the
//              signed-in user's own slice, e.g. Planner Today), or "client" (one client).
// FULL at a NARROW scope (viewer/client) does NOT imply agency-wide coverage — this is
// how scope escalation is prevented.
export type CoverageLevel = "signal" | "full";
export type CoverageBreadth = "agency" | "viewer" | "client";
export interface CoverageScope {
  breadth: CoverageBreadth;
  ref?: string; // e.g. a client id; omitted for agency/viewer
}
export interface CoverageContribution {
  domain: CoverageKey;
  level: CoverageLevel;
  scope: CoverageScope;
}

/** Per-domain tally: the strongest level seen, and whether an AGENCY-scoped FULL exists
 *  (the only thing that counts toward agency-wide completeness). */
export interface CoverageTally {
  level: CoverageLevel; // full if any full contribution (any scope), else signal
  agencyFull: boolean; // a {level:"full", scope.breadth:"agency"} contribution exists
}
export type CoverageMap = Map<CoverageKey, CoverageTally>;

/** Fold one successful contribution into the map (keeps the strongest valid state). */
export function recordContribution(map: CoverageMap, c: CoverageContribution): void {
  const prev = map.get(c.domain);
  const level: CoverageLevel = c.level === "full" || prev?.level === "full" ? "full" : "signal";
  const agencyFull = (c.level === "full" && c.scope.breadth === "agency") || prev?.agencyFull === true;
  map.set(c.domain, { level, agencyFull });
}

/** Deterministic metric → coverage contribution for portal_aggregate. Every metric is a
 *  SIGNAL (a count/slice) at AGENCY scope — never FULL domain coverage. Unknown ⇒ null. */
const AGGREGATE_METRIC_DOMAIN: Readonly<Record<string, CoverageKey>> = {
  clients_by_status: "clients",
  open_tasks: "tasks_today",
  overdue_tasks: "tasks_today",
  tasks_due_today: "tasks_today",
  tasks_scheduled_today: "tasks_today",
  incomplete_onboarding: "onboarding",
  unpaid_invoices: "invoices",
  stage_distribution: "project_stages",
  stale_clients: "client_updates",
};
export function aggregateMetricContribution(metric: string): CoverageContribution | null {
  const domain = AGGREGATE_METRIC_DOMAIN[metric];
  return domain ? { domain, level: "signal", scope: { breadth: "agency" } } : null;
}

/**
 * Is a BROAD agency-wide assessment COMPLETELY covered? True only when EVERY
 * agency-relevant SUPPORTED domain has an AGENCY-scoped FULL tally AND there are NO
 * agency-relevant UNSUPPORTED domains outstanding. Signal-only or narrow-scope-full do
 * NOT satisfy it. While any relevant domain is unsupported (current milestone) this is
 * always false — a broad answer can never be "verified" yet.
 */
export function broadCoverageComplete(map: CoverageMap): boolean {
  if (UNSUPPORTED_AGENCY_KEYS.length > 0) return false;
  return SUPPORTED_AGENCY_KEYS.every((k) => map.get(k)?.agencyFull === true);
}

/** Three honest coverage buckets (as human labels) for the answer/trace:
 *   • full       — checked completely for the stated scope (a FULL contribution);
 *   • signalOnly — checked as limited signals only (count/aggregate, no FULL);
 *   • notChecked — not checked / unavailable.
 *  For a BROAD question the agency universe defines notChecked; for a NARROW question
 *  only explicitly-asked unsupported domains are added (so narrow answers stay focused). */
export function buildCoverageBuckets(args: {
  map: CoverageMap;
  breadth: QuestionBreadth;
  askedUnsupported: CoverageKey[];
}): { full: string[]; signalOnly: string[]; notChecked: string[] } {
  const { map, breadth, askedUnsupported } = args;
  const full: string[] = [];
  const signalOnly: string[] = [];
  const notCheckedKeys = new Set<CoverageKey>();

  for (const [key, tally] of map) {
    if (tally.level === "full") full.push(labelFor(key));
    else signalOnly.push(labelFor(key));
  }
  if (breadth === "broad") {
    for (const k of AGENCY_RELEVANT_KEYS) if (!map.has(k)) notCheckedKeys.add(k);
  }
  for (const k of askedUnsupported) if (!map.has(k)) notCheckedKeys.add(k);

  return { full, signalOnly, notChecked: [...notCheckedKeys].map(labelFor) };
}

/**
 * The single AUTHORITATIVE, app-owned evidence-coverage summary, rendered from the
 * deterministic buckets. This is appended to the answer by trusted code so the main
 * answer and the confidence section cannot disagree about FULL vs SIGNAL — the model
 * never classifies coverage itself. FULL = authoritative for the stated scope; SIGNAL =
 * limited observations (aggregate counts, filtered client lists); NOT CHECKED = no
 * successful relevant retrieval. A filtered count that evaluated every client is still a
 * SIGNAL, never FULL.
 */
export function formatCoverageSummary(buckets: { full: string[]; signalOnly: string[]; notChecked: string[] }): string {
  const list = (xs: string[]) => (xs.length > 0 ? xs.join(", ") : "none");
  return [
    "Evidence coverage (authoritative — set by the system, not the assistant):",
    `- Checked completely (authoritative for the stated scope): ${list(buckets.full)}`,
    `- Checked as limited signals only (aggregate counts / filtered lists): ${list(buckets.signalOnly)}`,
    `- Not checked / unavailable: ${list(buckets.notChecked)}`,
  ].join("\n");
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
