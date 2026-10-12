/**
 * Jarvis Milestone A — agentic read observability (SAFE: names/counts/status only).
 *
 * Pure types (no I/O, no secrets). Mirrors the Slice-1 trace discipline: we record what
 * the agent looked at and how the turn terminated — never raw rows, args, provider text,
 * credentials, or payloads.
 */

export type AgenticToolStatus = "ok" | "invalid_input" | "unauthorized" | "error" | "timeout" | "deduped" | "budget_skipped";

export interface AgenticToolCall {
  name: string;
  scope: "agency" | "client";
  status: AgenticToolStatus;
  /** Portal domains/tables the tool read (names only). */
  domains: string[];
  total: number | null;
  shown: number;
  truncated: boolean;
  tookMs: number;
}

export type AgenticTermination = "final_answer" | "max_rounds" | "deadline" | "budget" | "no_tool" | "finalize_forced";

export interface AgenticTrace {
  mode: "agentic";
  rounds: number;
  maxRounds: number;
  providerCalls: number;
  toolCalls: AgenticToolCall[];
  evidenceEstTokens: number;
  evidenceBudget: number;
  termination: AgenticTermination;
  /** Question-coverage axis: deterministic breadth of the user's question. */
  questionBreadth: "broad" | "narrow";
  /** Source-coverage axis (granular): domains checked COMPLETELY for their scope (full),
   *  domains checked as LIMITED SIGNALS ONLY (counts/slices), and domains NOT checked /
   *  unavailable. Labels only — no raw rows. */
  coverage: { full: string[]; signalOnly: string[]; notChecked: string[] };
  /** Reliability contract (app-owned, coverage-aware): VERIFIED = authoritative sources
   *  read AND sufficient for the question; PARTIAL = read failed/bounded OR a broad
   *  question not fully covered; UNAVAILABLE = nothing read. */
  reliability: "verified" | "partial" | "unavailable";
  confidence: "high" | "qualified";
  confidenceBasis: string;
  totalMs: number;
}
