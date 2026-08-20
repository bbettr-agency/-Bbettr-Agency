import "server-only";
import { randomUUID } from "crypto";
import { createGoogleCalendarProvider, isGoogleConfigured } from "@/lib/google";
import { newCorrelationId } from "@/lib/net";
import { createSupabaseProjectionStore } from "./supabase-store";
import { createMeetingDesiredStateProvider } from "@/lib/planner/meetings/desired-provider";
import { productionSyncLogger } from "./sync-log";
import {
  projectEntity,
  reconcilePending,
  type EngineDeps,
  type ReconcileResult,
  type ReconcileSummary,
} from "./reconcile";
import { rebuildProjections, type RebuildOptions, type RebuildSummary } from "./rebuild";
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

/**
 * Max wall-clock a single scheduled reconcile pass may spend before stopping and
 * leaving the rest for the next tick. Keep it below the route's function timeout.
 * Configurable via PLANNER_RECONCILE_MAX_MS; default 8s.
 */
const RECONCILE_MAX_MS = Number(process.env.PLANNER_RECONCILE_MAX_MS) || 8000;

function buildDeps(
  correlationId: string,
  providerOpts: { maxRetries?: number } = {}
): EngineDeps {
  return {
    provider: createGoogleCalendarProvider(correlationId, providerOpts),
    store: createSupabaseProjectionStore(),
    desired: createMeetingDesiredStateProvider(),
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
 * Admin-initiated "Retry sync" for ONE existing meeting. Same reconciliation
 * engine and deterministic same-event guarantees as every other path — it only
 * PROJECTS the existing meeting (never inserts a Portal meeting, never creates a
 * second Google event/Meet). Uses the default retry budget (a user clicked it,
 * so spend a couple of attempts) and still honours the Google-config gate, so it
 * can't bypass configuration/OAuth checks. Per-row single-flight locking makes
 * concurrent clicks / an overlapping scheduler tick safe.
 */
export async function reconcileMeetingManually(
  entityId: string,
  correlationId: string = newCorrelationId()
): Promise<MeetingReconcileResult> {
  if (!isGoogleConfigured()) return { result: "skipped", reason: "not_configured" };
  return projectEntity(
    buildDeps(correlationId),
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
  return reconcilePending(buildDeps(correlationId), {
    limit,
    correlationId,
    maxDurationMs: RECONCILE_MAX_MS,
  });
}

/**
 * Rebuild all Portal-managed projections (the reconstructability operation).
 * Returns the structured audit summary. No-op (empty summary) when Google isn't
 * configured. Safe in-place re-sync by default; pass `freshIds` for the
 * calendar/account-change case.
 */
export async function rebuildCalendar(
  opts: RebuildOptions = {},
  correlationId: string = newCorrelationId()
): Promise<RebuildSummary> {
  if (!isGoogleConfigured()) {
    return { processed: 0, rebuilt: 0, skipped: 0, failed: 0, durationMs: 0, items: [] };
  }
  return rebuildProjections(buildDeps(correlationId), opts, correlationId);
}

/**
 * Default Scheduler: one due-reconciliation pass. The scheduling adapter (a
 * Supabase scheduled function → internal endpoint) calls this; swapping the
 * trigger changes only the adapter.
 */
export const reconciliationScheduler: Scheduler = {
  tick: (correlationId: string) => reconcileDue(undefined, correlationId),
};
