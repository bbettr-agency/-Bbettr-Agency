import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Meeting, MeetingAttendee } from "@/lib/database.types";
import type { SafeProjectionView } from "./view-types";

export type { SafeProjectionView } from "./view-types";

/**
 * Read side of the meetings domain. Meeting reads use the session (RLS) client;
 * the projection read uses the service-role client but exposes ONLY a safe view.
 */

/** Live (non-deleted) meetings, soonest first. */
export async function listMeetings(): Promise<Meeting[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("meetings")
    .select("*")
    .is("deleted_at", null)
    .order("starts_at", { ascending: true });
  return data ?? [];
}

export async function getMeeting(
  id: string
): Promise<{ meeting: Meeting; attendees: MeetingAttendee[] } | null> {
  const supabase = await createClient();
  const { data: meeting } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!meeting) return null;
  const { data: attendees } = await supabase
    .from("meeting_attendees")
    .select("*")
    .eq("meeting_id", id)
    .order("created_at", { ascending: true });
  return { meeting, attendees: attendees ?? [] };
}

export async function getSafeProjectionViews(
  entityIds: string[]
): Promise<Map<string, SafeProjectionView>> {
  const map = new Map<string, SafeProjectionView>();
  if (entityIds.length === 0) return map;
  const admin = createAdminClient();
  const { data } = await admin
    .from("calendar_projections")
    .select("entity_id, sync_state, meet_state, meet_url, last_sync_at")
    .eq("entity_type", "meeting")
    .in("entity_id", entityIds);
  for (const r of data ?? []) {
    map.set(r.entity_id, {
      entityId: r.entity_id,
      syncState: r.sync_state,
      meetState: r.meet_state,
      meetUrl: r.meet_url,
      lastSyncAt: r.last_sync_at,
    });
  }
  return map;
}
