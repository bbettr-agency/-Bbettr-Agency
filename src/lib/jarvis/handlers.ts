import "server-only";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { runTaskCommand } from "@/lib/planner/tasks/run-command";
import type { JarvisContext } from "./identity";
import type { VerificationResult } from "./verification";
import type { ProposeInternalTaskArgs } from "./capabilities";

/**
 * Capability HANDLERS (the only side-effecting boundary; server-only). Looked up
 * by capability id by the dispatch/proposal layers AFTER the deterministic
 * policy has allowed the action. Handlers never re-decide authorization — they
 * assume the policy passed — but they DO use narrow, legal Portal boundaries
 * (e.g. the existing apply_task_command via runTaskCommand), never raw SQL or a
 * generic service-role surface.
 */
export interface HandlerResult {
  data: unknown;
  verification: VerificationResult;
}
export type Handler = (ctx: JarvisContext, args: unknown) => Promise<HandlerResult>;

const HANDLERS: Record<string, Handler> = {
  "jarvis.ping": async () => ({ data: { ok: true }, verification: { state: "not_required" } }),

  "portal.read_task_counts": async (ctx) => {
    // Read-only via the caller's RLS (admin, agency workspace). No mutation.
    const supabase = await createClient();
    const { data } = await supabase.from("tasks").select("status").eq("workspace_id", ctx.workspaceId);
    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      const s = (row as { status: string }).status;
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return { data: { counts }, verification: { state: "not_required" } };
  },

  "portal.propose_internal_task": async (_ctx, args) => {
    const { title } = args as ProposeInternalTaskArgs;
    // Route through the ONE legal task write path. runTaskCommand independently
    // re-checks authenticated admin + workspace and stamps the human actor, and
    // is gated by TASKS_ENABLED — a disabled domain returns a clean failure
    // (never a false success).
    const res = await runTaskCommand(
      { command: { type: "CaptureTask", title }, idempotency_key: randomUUID() },
      { revalidate: [] }
    );
    // HONESTY BOUNDARY: runTaskCommand signals failure by RETURNING { ok:false }
    // (e.g. a disabled domain, a version conflict, a mapped DB error) — it does
    // NOT throw. If we ignored that, Jarvis would record a false success. So a
    // returned failure is surfaced as a thrown execution error, which the
    // execution layer records as success=false / verification=failed. `code` is
    // a safe typed discriminant (never raw DB text).
    if (!res.ok) throw new Error(`internal task command failed: ${res.code}`);
    // Authoritative transactional success: the adapter returns a COMMITTED taskId
    // + outcome only after apply_task_command committed. That committed result is
    // itself the independent evidence the side effect persisted — so this is
    // genuinely `verified`, not merely `not_required` (no external adapter needed
    // because the Planner command result is transactionally authoritative).
    return {
      data: { outcome: res.outcome, taskId: res.taskId },
      verification: { state: "verified", evidence: { taskId: res.taskId, outcome: res.outcome } },
    };
  },

  "integrations.read_deployment_state": async () => ({
    // Monitor-only, no adapter in Foundation 1 → reports unknown/unverified.
    data: { state: "unknown", reason: "no verification adapter in Foundation 1" },
    verification: { state: "unavailable" },
  }),
};

export function getHandler(id: string): Handler | null {
  return Object.prototype.hasOwnProperty.call(HANDLERS, id) ? HANDLERS[id] : null;
}
