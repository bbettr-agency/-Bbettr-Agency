import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGoogleConfig } from "@/lib/google/config";
import type { DesiredDraft } from "@/lib/planner/scheduling/types";
import { meetingToDesiredDraft } from "./desired";

/**
 * Load the authoritative desired projection state for a meeting (service-role,
 * so it sees soft-deleted rows too). Returns null when the meeting no longer
 * exists at all, or when Google isn't configured (no target calendar). A
 * soft-deleted/cancelled meeting still returns a draft — with intent
 * deleted/cancelled — so the reconciler removes/cancels the Google event.
 */
export async function loadMeetingDesired(
  entityId: string
): Promise<DesiredDraft | null> {
  const cfg = getGoogleConfig();
  if (!cfg) return null;

  const admin = createAdminClient();
  const { data: meeting } = await admin
    .from("meetings")
    .select(
      "id, title, description, starts_at, ends_at, time_zone, has_meet, status, deleted_at"
    )
    .eq("id", entityId)
    .maybeSingle();
  if (!meeting) return null;

  const { data: attendees } = await admin
    .from("meeting_attendees")
    .select("email, display_name")
    .eq("meeting_id", entityId);

  return meetingToDesiredDraft(meeting, attendees ?? [], cfg.calendarId);
}
