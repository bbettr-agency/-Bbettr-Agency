import type { MeetState } from "@/lib/database.types";

/**
 * Provider-agnostic scheduling contract (the Projection Contract).
 *
 * Every calendar provider supports the same four operations — create, update,
 * delete, reconcile. Google is the first implementation; a fake implements the
 * same interface for tests. The reconciliation engine depends ONLY on this
 * interface, never on Google specifics.
 *
 * A `DesiredEvent` is the complete, self-contained description of an event built
 * entirely from authoritative Portal data — nothing here is read back from
 * Google. This is what makes every event reconstructable.
 */

/** Desired lifecycle of the underlying Portal entity. */
export type ProjectionIntent = "active" | "cancelled" | "deleted";

export interface DesiredAttendee {
  email: string;
  displayName?: string | null;
}

/**
 * Desired state as loaded from Portal data, WITHOUT idEpoch. The engine injects
 * idEpoch from the projection record (it is reflected/cache state, and advancing
 * it is how a rebuild mints a fresh id namespace).
 */
export type DesiredDraft = Omit<DesiredEvent, "idEpoch">;

/** Everything needed to (re)create a provider event from Portal data alone. */
export interface DesiredEvent {
  entityType: "meeting";
  entityId: string;
  /** Bumped on rebuild to mint a fresh deterministic id namespace (see event-id). */
  idEpoch: number;
  calendarId: string;
  title: string;
  description?: string | null;
  /** RFC3339 instants. */
  startsAt: string;
  endsAt: string;
  /** IANA zone sent to the provider so DST is handled by the zone. */
  timeZone: string;
  attendees: DesiredAttendee[];
  wantsMeet: boolean;
  intent: ProjectionIntent;
}

/** Reflected provider state after an operation (a rebuildable cache). */
export interface ReflectedEvent {
  googleEventId: string;
  etag: string | null;
  meetUrl: string | null;
  meetState: MeetState;
  /** Sanitized code/message only — never a raw provider body. */
  meetError?: string | null;
}

/** Result of a single-item reconcile. */
export type ProviderOutcome =
  | { kind: "projected"; event: ReflectedEvent }
  | { kind: "deleted" };

/** Reference to an already-projected provider event. */
export interface EventRef {
  eventId: string;
  etag: string | null;
}

/**
 * The four-operation calendar provider contract. `reconcile` is the idempotent
 * single-item entry the engine calls; create/update/delete are the primitives it
 * composes (also individually exercisable).
 */
export interface CalendarProvider {
  create(desired: DesiredEvent): Promise<ReflectedEvent>;
  update(desired: DesiredEvent, ref: EventRef): Promise<ReflectedEvent>;
  delete(ref: { eventId: string; calendarId: string }): Promise<void>;
  /**
   * Read-only fetch of the current reflected state (a GET). Used to refresh a
   * still-provisioning Meet link without a PATCH (which would re-notify guests).
   */
  read(desired: DesiredEvent): Promise<ReflectedEvent>;
  reconcile(
    desired: DesiredEvent,
    current: { googleEventId: string | null; etag: string | null }
  ): Promise<ProviderOutcome>;
}
