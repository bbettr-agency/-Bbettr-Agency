import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";

type ActivityInsert = Database["public"]["Tables"]["activity_events"]["Insert"];

export interface LogActivityInput {
  clientId: string;
  /** Stable event key, e.g. "project_created", "invoice_paid", "design_started". */
  type: string;
  /** Client-facing label shown on the timeline. */
  title: string;
  description?: string | null;
  /** "client" (visible to the client) or "internal" (admins only). Defaults to client. */
  visibility?: "client" | "internal";
  icon?: string | null;
  /** Milestone time; defaults to now() in the DB. */
  occurredAt?: string;
  source?: "system" | "manual";
  createdBy?: string | null;
}

/**
 * Append an event to the standalone activity stream.
 *
 * Best-effort and additive by design: it NEVER throws, so a logging failure can
 * never break the action that triggered it. Writes go through the service-role
 * client. (Wiring this into existing actions — client created, stage advanced,
 * etc. — is a later phase; existing project logic is not touched here.)
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    const admin = createAdminClient();
    const row: ActivityInsert = {
      client_id: input.clientId,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      visibility: input.visibility ?? "client",
      icon: input.icon ?? null,
      occurred_at: input.occurredAt,
      source: input.source ?? "system",
      created_by: input.createdBy ?? null,
    };
    await admin.from("activity_events").insert(row);
  } catch {
    // Logging is non-critical — swallow so callers are unaffected.
  }
}
