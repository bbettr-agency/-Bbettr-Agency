import { computeDesiredHash } from "./hash";
import { isDisconnectError, sanitizeSyncError } from "./sanitize";
import { noopSyncLogger, type SyncLogger } from "./observability";
import type {
  CalendarProvider,
  DesiredDraft,
  DesiredEvent,
} from "./types";
import type { EntityRef, ProjectionRecord, ProjectionStore } from "./store";
import type { DesiredStateProvider } from "./desired-provider";

/**
 * The reconciliation engine: makes the reflected Google projection match desired
 * Portal state, idempotently and safe to replay at any time. Provider-agnostic
 * and dependency-injected (provider + store + logger + clock), so it is fully
 * unit-testable against a fake provider and an in-memory store.
 *
 * Guarantees:
 *  - single-flight per entity (lock; stale locks are reclaimable);
 *  - no duplicate work: a synced projection whose desired hash is unchanged is a
 *    no-op (idempotent replay);
 *  - transient failures leave the row retryable with backoff; an auth failure
 *    marks it `disconnected` (paused until reconnect);
 *  - Meet is modelled explicitly: an event can be `synced` while Meet is still
 *    `pending`, in which case the row stays due so a later pass promotes it.
 */

export interface EngineDeps {
  provider: CalendarProvider;
  store: ProjectionStore;
  desired: DesiredStateProvider;
  log?: SyncLogger;
  now: () => Date;
  newToken: () => string;
  /** A lock older than this is reclaimable (default 5 min). */
  lockStaleMs?: number;
  /** Re-poll delay while Meet is still provisioning (default 30 s). */
  meetPollMs?: number;
  /** Backoff before the next attempt after a failure (default exp, capped 30 min). */
  backoffMs?: (attempts: number) => number;
}

export type ReconcileResult =
  | { result: "success"; operation: "create" | "update" | "delete"; meetPending?: boolean }
  | { result: "skipped"; reason: "no_entity" | "locked" | "no_change" }
  | { result: "failure"; reason: string; disconnected: boolean };

const DEFAULT_LOCK_STALE_MS = 5 * 60 * 1000;
const DEFAULT_MEET_POLL_MS = 30 * 1000;
const defaultBackoff = (attempts: number) =>
  Math.min(60_000 * 2 ** (attempts - 1), 30 * 60_000);

/** Build the delete-intent desired event from a projection record alone. */
function deletedDesiredFrom(rec: ProjectionRecord): DesiredEvent {
  return {
    entityType: rec.entityType,
    entityId: rec.entityId,
    idEpoch: rec.idEpoch,
    calendarId: rec.googleCalendarId,
    title: "",
    startsAt: "",
    endsAt: "",
    timeZone: "UTC",
    attendees: [],
    wantsMeet: false,
    intent: "deleted",
  };
}

/** Reconcile a single entity's projection. Idempotent and replay-safe. */
export async function projectEntity(
  deps: EngineDeps,
  ref: EntityRef,
  correlationId: string
): Promise<ReconcileResult> {
  const log = deps.log ?? noopSyncLogger;
  const lockStaleMs = deps.lockStaleMs ?? DEFAULT_LOCK_STALE_MS;
  const meetPollMs = deps.meetPollMs ?? DEFAULT_MEET_POLL_MS;
  const backoff = deps.backoffMs ?? defaultBackoff;
  const startedMs = deps.now().getTime();
  // Pre-declared (not const) so the hoisted `finish` can read it even on the
  // earliest return, before a calendar is known.
  let calendarId = "";

  const draft: DesiredDraft | null = await deps.desired.loadDesired(ref);
  let rec = await deps.store.loadProjection(ref);

  // Nothing to project and nothing projected → nothing to do.
  if (!draft && !rec) {
    return finish("skipped", { reason: "no_entity" }, null);
  }

  calendarId = draft?.calendarId ?? rec!.googleCalendarId;
  if (!rec) rec = await deps.store.ensureProjection(ref, calendarId);

  // Acquire the single-flight lock (reclaim a stale one).
  const token = deps.newToken();
  const nowIso = deps.now().toISOString();
  const staleBeforeIso = new Date(deps.now().getTime() - lockStaleMs).toISOString();
  const locked = await deps.store.acquireLock(rec.id, token, nowIso, staleBeforeIso);
  if (!locked) return finish("skipped", { reason: "locked" }, rec.googleEventId);
  rec = locked;

  // Finalise desired: inject idEpoch (reflected state) and compute the hash.
  const desired: DesiredEvent = draft
    ? { ...draft, idEpoch: rec.idEpoch }
    : deletedDesiredFrom(rec);
  const desiredHash = computeDesiredHash(desired);
  const isRemoval = desired.intent !== "active";

  // No-op: already synced to this exact desired state, and Meet isn't mid-flight.
  if (
    !isRemoval &&
    rec.syncState === "synced" &&
    rec.syncedHash === desiredHash &&
    rec.meetState !== "pending"
  ) {
    await deps.store.saveResult(rec.id, { releaseLock: token });
    return finish("skipped", { reason: "no_change" }, rec.googleEventId);
  }

  try {
    const outcome = await deps.provider.reconcile(desired, {
      googleEventId: rec.googleEventId,
      etag: rec.etag,
    });

    if (outcome.kind === "deleted") {
      await deps.store.saveResult(rec.id, {
        syncState: "synced",
        googleEventId: null,
        etag: null,
        meetUrl: null,
        meetState: "not_requested",
        lastMeetError: null,
        syncedHash: desiredHash,
        syncAttempts: 0,
        nextAttemptAt: null,
        lastSyncAt: deps.now().toISOString(),
        lastSyncError: null,
        releaseLock: token,
      });
      return finish("success", { operation: "delete" }, null);
    }

    const ev = outcome.event;
    const meetPending = ev.meetState === "pending";
    await deps.store.saveResult(rec.id, {
      syncState: "synced",
      googleEventId: ev.googleEventId,
      etag: ev.etag,
      meetUrl: ev.meetUrl,
      meetState: ev.meetState,
      lastMeetError: ev.meetError ?? null,
      syncedHash: desiredHash,
      syncAttempts: 0,
      // Keep the row due so a later pass promotes Meet pending → ready.
      nextAttemptAt: meetPending
        ? new Date(deps.now().getTime() + meetPollMs).toISOString()
        : null,
      lastSyncAt: deps.now().toISOString(),
      lastSyncError: null,
      releaseLock: token,
    });
    return finish(
      "success",
      { operation: rec.googleEventId ? "update" : "create", meetPending },
      ev.googleEventId
    );
  } catch (err) {
    const reason = sanitizeSyncError(err);
    const disconnected = isDisconnectError(err);
    const attempts = rec.syncAttempts + 1;
    await deps.store.saveResult(rec.id, {
      syncState: disconnected ? "disconnected" : "failed",
      syncAttempts: attempts,
      lastSyncError: reason,
      // Disconnected pauses until reconnect; otherwise back off and retry.
      nextAttemptAt: disconnected
        ? null
        : new Date(deps.now().getTime() + backoff(attempts)).toISOString(),
      releaseLock: token,
    });
    return finish("failure", { reason, disconnected }, rec.googleEventId);
  }

  // Emit one structured observability line per attempt, then return.
  function finish(
    result: "success" | "failure" | "skipped",
    extra: {
      operation?: "create" | "update" | "delete";
      reason?: string;
      disconnected?: boolean;
      meetPending?: boolean;
    },
    googleEventId: string | null
  ): ReconcileResult {
    log({
      correlationId,
      entityType: ref.entityType,
      entityId: ref.entityId,
      googleCalendarId: calendarId,
      googleEventId,
      operation: extra.operation ?? "reconcile",
      durationMs: deps.now().getTime() - startedMs,
      result,
      reason: extra.reason,
    });
    if (result === "success") {
      return {
        result,
        operation: extra.operation ?? "update",
        meetPending: extra.meetPending,
      };
    }
    if (result === "failure") {
      return { result, reason: extra.reason ?? "error", disconnected: !!extra.disconnected };
    }
    return { result, reason: extra.reason as "no_entity" | "locked" | "no_change" };
  }
}

export interface ReconcileSummary {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

/**
 * Reconcile a batch of due projections (pending/failed past their backoff).
 * Idempotent and safe to run from a scheduled/internal trigger at any time.
 */
export async function reconcilePending(
  deps: EngineDeps,
  opts: { limit: number; correlationId: string }
): Promise<ReconcileSummary> {
  const due = await deps.store.listDue(opts.limit, deps.now().toISOString());
  const summary: ReconcileSummary = { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
  for (const rec of due) {
    const r = await projectEntity(
      deps,
      { entityType: rec.entityType, entityId: rec.entityId },
      opts.correlationId
    );
    summary.processed++;
    if (r.result === "success") summary.succeeded++;
    else if (r.result === "failure") summary.failed++;
    else summary.skipped++;
  }
  return summary;
}
