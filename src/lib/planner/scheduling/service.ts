import "server-only";
import { randomUUID } from "crypto";
import { createGoogleCalendarProvider, isGoogleConfigured } from "@/lib/google";
import { newCorrelationId } from "@/lib/net";
import { createSupabaseProjectionStore } from "./supabase-store";
import { productionSyncLogger } from "./sync-log";
import {
  projectEntity,
  reconcilePending,
  type EngineDeps,
  type ReconcileResult,
  type ReconcileSummary,
} from "./reconcile";
import type { Scheduler } from "./scheduler";

/**
 * Reconciliation application service.
 *
 * The single place that wires persistence (ProjectionStore) + provider
 * (CalendarProvider) + logger + clock into the engine. All synchronization
 * decisions live here and below — server actions merely call `reconcileMeeting`
 * after they commit; they contain no sync logic (refinement 2).
 *
 * Google failing is never fatal: when Google isn't configured this is a no-op,
 * and every projection failure is recorded on the row for the scheduler.
 */

function buildDeps(
  correlationId: string,
  providerOpts: { maxRetries?: number } = {}
): EngineDeps {
  return {
    provider: createGoogleCalendarProvider(correlationId, providerOpts),
    store: createSupabaseProjectionStore(),
    log: productionSyncLogger,
    now: () => new Date(),
    newToken: () => randomUUID(),
  };
}

export type MeetingReconcileResult =
  | ReconcileResult
  | { result: "skipped"; reason: "not_configured" };

/**
 * Inline, post-commit projection for one meeting. Single attempt (maxRetries 0)
 * so a server action is bounded to ~one provider call; any failure just leaves
 * the row pending for the scheduler. Portal writes always succeed independently.
 */
export async function reconcileMeeting(
  entityId: string,
  correlationId: string = newCorrelationId()
): Promise<MeetingReconcileResult> {
  if (!isGoogleConfigured()) return { result: "skipped", reason: "not_configured" };
  return projectEntity(
    buildDeps(correlationId, { maxRetries: 0 }),
    { entityType: "meeting", entityId },
    correlationId
  );
}

/**
 * Batch reconcile of due projections — the reliable backstop. Idempotent and
 * replay-safe; uses the default retry budget (this path is not user-facing).
 */
export async function reconcileDue(
  limit = 25,
  correlationId: string = newCorrelationId()
): Promise<ReconcileSummary> {
  if (!isGoogleConfigured()) {
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
  }
  return reconcilePending(buildDeps(correlationId), { limit, correlationId });
}

/**
 * Default Scheduler: one due-reconciliation pass. The scheduling adapter (a
 * Supabase scheduled function → internal endpoint, wired in Stage 3.6) calls
 * this; swapping the trigger changes only the adapter.
 */
export const reconciliationScheduler: Scheduler = {
  tick: (correlationId: string) => reconcileDue(undefined, correlationId),
};
