import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/database.types";
import type { MemoryEventType } from "./types";

/**
 * Append one row to the APPEND-ONLY jarvis_memory_events lineage log (service
 * role; the table grants service_role INSERT+SELECT only and rejects UPDATE/
 * DELETE via trigger). Throws on failure — lineage must never be silently lost.
 * `detail` must NEVER contain secret material (callers pass only safe labels).
 */
export interface MemoryEventInput {
  workspaceId: string;
  memoryId?: string | null;
  eventType: MemoryEventType;
  actorKind?: "jarvis" | "human" | "system";
  actorUserId?: string | null;
  actorDisplay?: string | null;
  reason?: string | null;
  detail?: unknown;
}

export async function appendMemoryEvent(input: MemoryEventInput): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("jarvis_memory_events").insert({
    workspace_id: input.workspaceId,
    memory_id: input.memoryId ?? null,
    event_type: input.eventType,
    actor_kind: input.actorKind ?? "human",
    actor_user_id: input.actorUserId ?? null,
    actor_display: input.actorDisplay ?? null,
    reason: input.reason ?? null,
    detail: (input.detail as unknown as Json) ?? null,
  });
  if (error) throw new Error(`jarvis memory event append failed: ${error.message}`);
}
