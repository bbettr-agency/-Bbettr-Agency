import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CalendarProjection, Database } from "@/lib/database.types";

import type {
  EntityRef,
  ProjectionPatch,
  ProjectionRecord,
  ProjectionStore,
} from "./store";

type ProjectionUpdate =
  Database["public"]["Tables"]["calendar_projections"]["Update"];

/**
 * Supabase (service-role) implementation of the ProjectionStore boundary — the
 * reflected/cache layer ONLY. Desired-state loading is a separate concern
 * (DesiredStateProvider, owned by the meetings domain).
 *
 * The reconciliation engine depends only on this interface, so persistence is
 * fully replaceable (the tests use an in-memory version). This adapter owns:
 * loading/saving projection state, lock acquire/release, sync-metadata updates
 * and recording sanitized failures.
 *
 * calendar_projections is service-role only (RLS-locked), so this must run in
 * trusted server code exclusively.
 */

function mapRow(row: CalendarProjection): ProjectionRecord {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    googleCalendarId: row.google_calendar_id,
    googleEventId: row.google_event_id,
    idEpoch: row.id_epoch,
    etag: row.etag,
    meetUrl: row.meet_url,
    meetState: row.meet_state,
    lastMeetError: row.last_meet_error,
    syncState: row.sync_state,
    syncedHash: row.synced_hash,
    syncAttempts: row.sync_attempts,
    nextAttemptAt: row.next_attempt_at,
    lockedAt: row.locked_at,
    lockToken: row.lock_token,
  };
}

/** Map an engine patch (camelCase) to the DB update shape (snake_case). */
function mapPatch(patch: ProjectionPatch): ProjectionUpdate {
  const upd: ProjectionUpdate = { updated_at: new Date().toISOString() };
  if (patch.googleEventId !== undefined) upd.google_event_id = patch.googleEventId;
  if (patch.etag !== undefined) upd.etag = patch.etag;
  if (patch.meetUrl !== undefined) upd.meet_url = patch.meetUrl;
  if (patch.meetState !== undefined) upd.meet_state = patch.meetState;
  if (patch.lastMeetError !== undefined) upd.last_meet_error = patch.lastMeetError;
  if (patch.syncState !== undefined) upd.sync_state = patch.syncState;
  if (patch.syncedHash !== undefined) upd.synced_hash = patch.syncedHash;
  if (patch.syncAttempts !== undefined) upd.sync_attempts = patch.syncAttempts;
  if (patch.nextAttemptAt !== undefined) upd.next_attempt_at = patch.nextAttemptAt;
  if (patch.lastSyncAt !== undefined) upd.last_sync_at = patch.lastSyncAt;
  if (patch.lastSyncError !== undefined) upd.last_sync_error = patch.lastSyncError;
  if (patch.releaseLock) {
    upd.locked_at = null;
    upd.lock_token = null;
  }
  return upd;
}

export function createSupabaseProjectionStore(): ProjectionStore {
  const admin = createAdminClient();

  async function loadProjection(ref: EntityRef): Promise<ProjectionRecord | null> {
    const { data } = await admin
      .from("calendar_projections")
      .select("*")
      .eq("entity_type", ref.entityType)
      .eq("entity_id", ref.entityId)
      .maybeSingle();
    return data ? mapRow(data) : null;
  }

  return {
    loadProjection,

    async ensureProjection(ref, calendarId) {
      const existing = await loadProjection(ref);
      if (existing) return existing;
      const { data, error } = await admin
        .from("calendar_projections")
        .insert({
          entity_type: ref.entityType,
          entity_id: ref.entityId,
          google_calendar_id: calendarId,
        })
        .select("*")
        .maybeSingle();
      if (error || !data) {
        // Possible concurrent insert — re-read.
        const again = await loadProjection(ref);
        if (again) return again;
        throw error ?? new Error("Could not create projection row.");
      }
      return mapRow(data);
    },

    async acquireLock(id, token, nowIso, staleBeforeIso) {
      const { data } = await admin
        .from("calendar_projections")
        .update({ locked_at: nowIso, lock_token: token, updated_at: nowIso })
        .eq("id", id)
        .or(`locked_at.is.null,locked_at.lt.${staleBeforeIso}`)
        .select("*")
        .maybeSingle();
      return data ? mapRow(data) : null;
    },

    async saveResult(id, patch) {
      await admin.from("calendar_projections").update(mapPatch(patch)).eq("id", id);
    },

    async listDue(limit, nowIso) {
      const { data } = await admin
        .from("calendar_projections")
        .select("*")
        .in("sync_state", ["pending", "failed"])
        .is("locked_at", null)
        .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
        .order("next_attempt_at", { ascending: true, nullsFirst: true })
        .limit(limit);
      return (data ?? []).map(mapRow);
    },
  };
}
