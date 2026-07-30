import type { MeetState, ProjectionSyncState } from "@/lib/database.types";

/**
 * Projection persistence contract (the reflected/cache layer).
 *
 * This has ONE responsibility: managing projection state. Desired-state loading
 * belongs to the domain and is a separate interface (DesiredStateProvider).
 *
 * The engine depends on this interface, not on Supabase — so it is fully
 * unit-testable with an in-memory fake, and the real service-role-backed store
 * is a separate wiring detail. Every field here is a rebuildable cache of a
 * projection; the authoritative data lives in the Portal entity tables.
 */

export interface EntityRef {
  entityType: "meeting";
  entityId: string;
}

/** A projection row as the engine sees it. */
export interface ProjectionRecord {
  id: string;
  entityType: "meeting";
  entityId: string;
  googleCalendarId: string;
  googleEventId: string | null;
  idEpoch: number;
  etag: string | null;
  meetUrl: string | null;
  meetState: MeetState;
  lastMeetError: string | null;
  syncState: ProjectionSyncState;
  syncedHash: string | null;
  syncAttempts: number;
  nextAttemptAt: string | null;
  lockedAt: string | null;
  lockToken: string | null;
}

/** Partial update applied after an attempt; `releaseLock` clears a matching lock. */
export interface ProjectionPatch {
  googleEventId?: string | null;
  etag?: string | null;
  meetUrl?: string | null;
  meetState?: MeetState;
  lastMeetError?: string | null;
  syncState?: ProjectionSyncState;
  syncedHash?: string | null;
  syncAttempts?: number;
  nextAttemptAt?: string | null;
  lastSyncAt?: string;
  lastSyncError?: string | null;
  /** When set and it matches the held lock token, the lock is released. */
  releaseLock?: string;
}

export interface ProjectionStore {
  /** The projection record for an entity, or null if none exists yet. */
  loadProjection(ref: EntityRef): Promise<ProjectionRecord | null>;
  /** Create (pending) or return the projection record for an entity. */
  ensureProjection(ref: EntityRef, calendarId: string): Promise<ProjectionRecord>;
  /**
   * Claim the single-flight lock. Succeeds when unlocked or the existing lock is
   * stale (lockedAt < staleBeforeIso), returning the freshly-locked record;
   * otherwise returns null.
   */
  acquireLock(
    id: string,
    token: string,
    nowIso: string,
    staleBeforeIso: string
  ): Promise<ProjectionRecord | null>;
  /** Persist reflected state and (optionally) release the lock. */
  saveResult(id: string, patch: ProjectionPatch): Promise<void>;
  /** Due pending/failed projections (nextAttemptAt null or <= now), for batch reconcile. */
  listDue(limit: number, nowIso: string): Promise<ProjectionRecord[]>;
}
