import type { EntityRef } from "./store";
import type { DesiredDraft } from "./types";

/**
 * Desired-state contract (the domain boundary).
 *
 * The authoritative desired state for an entity is owned by its domain (the
 * meetings domain today). This interface lets the reconciliation engine read it
 * without knowing anything about meetings or Supabase. The engine depends on
 * three responsibilities, each its own interface:
 *
 *   DesiredStateProvider  → what the entity SHOULD look like (domain)
 *   ProjectionStore       → what we've reflected to the provider (cache)
 *   CalendarProvider      → the provider itself
 */
export interface DesiredStateProvider {
  /** Desired state for an entity (null if the entity is gone / not syncable). */
  loadDesired(ref: EntityRef): Promise<DesiredDraft | null>;
}
