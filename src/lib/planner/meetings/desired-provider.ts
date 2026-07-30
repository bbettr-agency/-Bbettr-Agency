import "server-only";
import type { DesiredStateProvider } from "@/lib/planner/scheduling/desired-provider";
import type { EntityRef } from "@/lib/planner/scheduling/store";
import type { DesiredDraft } from "@/lib/planner/scheduling/types";
import { loadMeetingDesired } from "./loader";

/**
 * Meetings-domain implementation of the DesiredStateProvider boundary. Owns
 * "what should this entity look like" for meetings; the engine reads through the
 * interface and stays ignorant of meetings and Supabase.
 */
export function createMeetingDesiredStateProvider(): DesiredStateProvider {
  return {
    async loadDesired(ref: EntityRef): Promise<DesiredDraft | null> {
      // Only meetings are projected in Phase 3.
      if (ref.entityType === "meeting") return loadMeetingDesired(ref.entityId);
      return null;
    },
  };
}
