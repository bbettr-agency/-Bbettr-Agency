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
  confidence: "high" | "qualified";
  confidenceBasis: string;
  totalMs: number;
}
