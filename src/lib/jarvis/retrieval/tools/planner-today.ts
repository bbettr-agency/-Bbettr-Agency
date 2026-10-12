import "server-only";

import { redactIfSecret } from "@/lib/jarvis/memory/secrets";
import { TaskError } from "@/lib/planner/tasks/errors";
import type { ReadToolDescriptor, ReadToolResult } from "./types";

// The authoritative server summary is imported LAZILY inside run() so the read-tool
// registry stays free of the Planner's Next/server-component import chain (React cache,
// next/headers) and remains importable in the node unit-test env. At runtime (server
// request) the dynamic import resolves normally.

/**
 * Jarvis Milestone A — authoritative PLANNER TODAY read tool.
 *
 * Returns EXACTLY the numbers the Planner Today dashboard shows, because it calls the
 * SAME shared authoritative summary (getTodayTaskSummary → getTodayWorkspace + recurring
 * projections + the pure actionableToday/todayProgress used by the UI). No competing
 * definition of "today": membership is scheduled-or-due today OR overdue in
 * Africa/Johannesburg, scope is the viewer's owner|assignee tasks, run under the
 * caller's admin+workspace RLS (never service-role). This replaces the misleading
 * `due_date = today` count as the answer to "what do I need to do today / what needs my
 * attention today".
 */

const MAX_TASK_TITLES = 25;

/** The UNAVAILABLE result (pure, exported for direct testing). Never reports a count and
 *  explicitly tells the model not to assert absence — honours the reliability contract. */
export function plannerTodayUnavailable(reason: string): ReadToolResult {
  return {
    content: `Planner Today could not be checked (tasks source ${reason}). Do NOT state there are no tasks — this scope was NOT verified.`,
    total: null,
    shown: 0,
    truncated: false,
    domains: ["tasks"],
    degraded: true,
    coverage: "unavailable",
  };
}

export const plannerTodayTool: ReadToolDescriptor<Record<string, never>> = {
  name: "portal_planner_today",
  scope: "agency",
  // Self-contained authoritative source for the "today's tasks" domain only.
  coverageBreadth: "narrow",
  providesCoverage: ["tasks_today"],
  requiredGrant: "portal.read",
  description:
    "Authoritative Planner Today for the signed-in user: the SAME figures the Planner Today dashboard shows. Returns total in Today, completed today, remaining (actionable), overdue, waiting, and the actual outstanding task titles/ids. Use this for 'what do I need to do today', 'what's outstanding today', 'what needs my attention today' — NOT portal_aggregate(tasks_due_today), which is only a narrow due_date count. RECURRING: this includes today's PROJECTED recurring occurrences only — it is NOT a complete list of recurring definitions, upcoming recurring work, or completed recurring history.",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  parse(raw) {
    if (raw !== undefined && raw !== null && (typeof raw !== "object" || Object.keys(raw as object).length > 0)) {
      return { ok: false, reason: "this tool takes no arguments" };
    }
    return { ok: true, args: {} };
  },
  async run(_args, rc, ctx): Promise<ReadToolResult> {
    let summary;
    try {
      const { getTodayTaskSummary } = await import("@/lib/planner/today/today-read-summary");
      summary = await getTodayTaskSummary(rc.now(), ctx.principalId);
    } catch (e) {
      // Tasks module disabled (or source error) ⇒ UNAVAILABLE — never assert "no tasks".
      return plannerTodayUnavailable(e instanceof TaskError ? e.code : "error");
    }

    const lines: string[] = [];
    lines.push(`Planner Today (your owner/assignee tasks, Africa/Johannesburg, ${summary.today}):`);
    lines.push(`- ${summary.totalActionable} total in Today (${summary.completed} completed, ${summary.remaining} remaining)`);
    lines.push(`- ${summary.overdue} overdue; ${summary.waiting} waiting`);
    if (summary.remainingTasks.length > 0) {
      lines.push(`Remaining (outstanding) tasks:`);
      for (const t of summary.remainingTasks.slice(0, MAX_TASK_TITLES)) {
        const flags = [t.isOverdue ? "overdue" : null, t.scheduledDate ? `scheduled ${t.scheduledDate}` : null, t.dueDate ? `due ${t.dueDate}` : null].filter(Boolean).join("; ");
        lines.push(`- ${redactIfSecret(t.title)} [id: ${t.id}${flags ? `; ${flags}` : ""}]`);
      }
      if (summary.remainingTasks.length > MAX_TASK_TITLES) lines.push(`- (+${summary.remainingTasks.length - MAX_TASK_TITLES} more remaining)`);
    } else {
      lines.push(`Remaining (outstanding) tasks: none — all Today tasks are completed or none are scheduled/due today.`);
    }
    lines.push(`Scope checked: Planner Today tasks only (scheduled-or-due today, Africa/Johannesburg) for you as owner/assignee. Does NOT include meetings, other team members' tasks, or work not in Today.`);
    // Recurring-reminder honesty (Correction 2): Today includes projected recurring
    // occurrences for TODAY only — not the full recurring picture.
    lines.push(
      `Recurring note: any recurring items here are TODAY's projected occurrences only — this is NOT a complete list of recurring definitions, NOT a view of upcoming recurring work, and NOT a history of completed recurring occurrences. Do not claim full recurring-reminder coverage from this.`
    );

    const truncated = summary.remainingTasks.length > MAX_TASK_TITLES;
    return {
      content: lines.join("\n"),
      total: summary.totalActionable,
      shown: Math.min(summary.remainingTasks.length, MAX_TASK_TITLES),
      truncated,
      domains: ["tasks"],
      coverage: truncated ? "partial" : "full",
    };
  },
};
