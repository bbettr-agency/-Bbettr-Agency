import "server-only";
import { logIntegrationEvent } from "@/lib/net";
import type { SyncLogFields, SyncLogger } from "./observability";

/**
 * Production SyncLogger: forwards each reconciliation attempt to the Phase-2
 * structured integration logger as a `calendar_sync` event. Injected into the
 * engine in production; the engine itself stays decoupled and testable.
 *
 * Only safe fields are forwarded (correction 8) — never descriptions, attendee
 * details or tokens. `reason` is already a sanitized code.
 */
export const productionSyncLogger: SyncLogger = (f: SyncLogFields) => {
  logIntegrationEvent(f.result === "failure" ? "error" : "info", {
    integration: "google",
    event: "calendar_sync",
    correlationId: f.correlationId,
    outcome:
      f.result === "success" ? "success" : f.result === "failure" ? "failure" : undefined,
    reason: f.reason,
    entityType: f.entityType,
    entityId: f.entityId,
    googleCalendarId: f.googleCalendarId,
    googleEventId: f.googleEventId ?? undefined,
    operation: f.operation,
    durationMs: f.durationMs,
    result: f.result,
  });
};
