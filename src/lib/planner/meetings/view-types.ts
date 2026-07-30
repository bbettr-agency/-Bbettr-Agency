import type { MeetState, ProjectionSyncState } from "@/lib/database.types";

/**
 * The ONLY projection data the UI may see (refinement 4). Pure module (no
 * server-only) so client components can import the type. Whitelisted safe fields
 * only — never raw rows, etags, locks, id_epoch or error payloads.
 */
export interface SafeProjectionView {
  entityId: string;
  syncState: ProjectionSyncState;
  meetState: MeetState;
  meetUrl: string | null;
  lastSyncAt: string | null;
}
