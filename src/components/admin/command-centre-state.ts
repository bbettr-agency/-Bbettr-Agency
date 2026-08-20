/**
 * Pure derivation for the admin Command Centre (Slice 2A) — no I/O, no JSX, so
 * the operating-dashboard logic is unit-testable in isolation.
 *
 * EXISTING DATA ONLY. Slice 2A deliberately introduces NO new stored state:
 *   • "Current focus / next milestone" is derived from project_stages.
 *   • "Attention" is derived from already-loaded billing / questions / readiness.
 * No per-service operational status, no website URL, no Planner task reads — those
 * are later slices. When the truth cannot be derived we say so with neutral
 * wording rather than fabricating an Active/Live state.
 */
import { formatCurrency } from "@/lib/utils";

// ── Current focus / next milestone (derived from the roadmap) ───────────────

type StageLike = {
  name: string;
  status: "completed" | "in_progress" | "pending";
  position: number;
  target_date: string | null;
};

export interface FocusState {
  hasStages: boolean;
  allComplete: boolean;
  /** Internal stage name of the current focus (admin-facing), or null. */
  currentLabel: string | null;
  /** Internal stage name of the next milestone, or null. */
  nextLabel: string | null;
  /** Current stage ETA, falling back to the client's estimated launch date. */
  etaDate: string | null;
}

/**
 * Current focus = the in-progress stage, else the first pending stage, else the
 * last stage (everything complete). Next = the first not-yet-complete stage
 * after the current one. Mirrors the existing journey/currentPhase semantics but
 * keeps the admin-facing internal stage names.
 */
export function deriveFocus(
  stages: StageLike[],
  estimatedLaunchDate: string | null
): FocusState {
  if (stages.length === 0) {
    return {
      hasStages: false,
      allComplete: false,
      currentLabel: null,
      nextLabel: null,
      etaDate: estimatedLaunchDate,
    };
  }
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  const allComplete = ordered.every((s) => s.status === "completed");
  const current =
    ordered.find((s) => s.status === "in_progress") ??
    ordered.find((s) => s.status === "pending") ??
    ordered[ordered.length - 1];
  const currentIdx = ordered.indexOf(current);
  const next =
    ordered.slice(currentIdx + 1).find((s) => s.status !== "completed") ?? null;
  return {
    hasStages: true,
    allComplete,
    currentLabel: allComplete ? null : current.name,
    nextLabel: allComplete ? null : next?.name ?? null,
    etaDate: current.target_date ?? estimatedLaunchDate,
  };
}

// ── Attention (derived from already-loaded data only) ───────────────────────

export type AttentionTone = "danger" | "warning";
export interface AttentionItem {
  kind: "billing" | "questions" | "readiness";
  label: string;
  tone: AttentionTone;
}

export interface AttentionInput {
  /** Sum of overdue invoice balances, per currency (derived, never stored). */
  overdueByCurrency: Record<string, number>;
  /** getClientBilling kpis.overdueCount — the count of overdue invoices. */
  overdueCount: number;
  /** Count of update_questions with status === "open". */
  openQuestions: number;
  /**
   * Count of still-outstanding required onboarding assets/access — ONLY when
   * assets have not yet been marked received (else 0). Represents "waiting on
   * client" without any Planner task read.
   */
  readinessPending: number;
}

/**
 * Zero or more attention items, most-urgent first. An empty array means the
 * Command Centre should stay quiet (no large empty warning card).
 */
export function deriveAttention(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (input.overdueCount > 0) {
    const amounts = Object.entries(input.overdueByCurrency)
      .filter(([, amt]) => amt > 0)
      .map(([currency, amt]) => formatCurrency(amt, currency))
      .join(" · ");
    items.push({
      kind: "billing",
      tone: "danger",
      label: amounts
        ? `Payment overdue — ${amounts}`
        : `${input.overdueCount} invoice${input.overdueCount === 1 ? "" : "s"} overdue`,
    });
  }

  if (input.openQuestions > 0) {
    items.push({
      kind: "questions",
      tone: "warning",
      label: `${input.openQuestions} open client question${input.openQuestions === 1 ? "" : "s"}`,
    });
  }

  if (input.readinessPending > 0) {
    items.push({
      kind: "readiness",
      tone: "warning",
      label: `Waiting on client — ${input.readinessPending} item${input.readinessPending === 1 ? "" : "s"} outstanding`,
    });
  }

  return items;
}
