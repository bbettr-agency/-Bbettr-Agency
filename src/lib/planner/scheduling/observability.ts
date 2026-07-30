/**
 * Structured observability contract for reconciliation (correction 8).
 *
 * Every reconciliation attempt logs exactly these fields. The type lives here
 * (pure, injectable) so the engine stays testable; the production adapter that
 * forwards to the Phase-2 integration logger is a separate server-only wiring.
 *
 * NEVER log event descriptions, attendee details, access/refresh tokens or raw
 * bodies. `reason` is a sanitized code only.
 */
export interface SyncLogFields {
  correlationId: string;
  entityType: string;
  entityId: string;
  googleCalendarId: string;
  googleEventId: string | null;
  operation: "create" | "update" | "delete" | "reconcile";
  durationMs: number;
  result: "success" | "failure" | "skipped";
  reason?: string;
}

export type SyncLogger = (fields: SyncLogFields) => void;

/** A logger that discards — the default when none is injected. */
export const noopSyncLogger: SyncLogger = () => {};
