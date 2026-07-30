import "server-only";
import {
  fetchJsonWithTimeout,
  fetchWithTimeout,
  withRetry,
  IntegrationApiError,
} from "@/lib/net";
import { getAccessToken } from "@/lib/google/connection";
import { getGoogleConfig } from "@/lib/google/config";
import type {
  CalendarProvider,
  DesiredEvent,
  EventRef,
  ProviderOutcome,
  ReflectedEvent,
} from "@/lib/planner/scheduling/types";
import { googleEventId } from "./event-id";
import {
  meetStateFromEvent,
  toGoogleEventBody,
  type GoogleEventResource,
} from "./mapper";

/**
 * Google Calendar implementation of the CalendarProvider contract.
 *
 * Native fetch on the Phase-2 net primitives: every call is timed out (8s) and
 * transient failures (timeout/network/429/5xx) are retried; terminal statuses
 * (409 duplicate id, 412 etag drift, 404/410 gone) are handled explicitly so the
 * operations are idempotent and replay-safe. Persistence, locking, backoff and
 * structured logging are the engine's job — this layer only talks to Google.
 */

const BASE = "https://www.googleapis.com/calendar/v3/calendars";
const TIMEOUT_MS = 8000;

/**
 * Provider tuning. The inline, post-commit projection uses `maxRetries: 0` so a
 * server action is bounded to a single ~8s attempt (failures just leave the row
 * pending for the scheduler); the scheduled reconciler uses the default retries.
 */
export interface GoogleCalendarProviderOptions {
  maxRetries?: number;
}

function sendUpdates(): string {
  return getGoogleConfig()?.sendUpdates ?? "none";
}

function reflect(ev: GoogleEventResource, wantsMeet: boolean): ReflectedEvent {
  const meet = meetStateFromEvent(ev, wantsMeet);
  return {
    googleEventId: ev.id ?? "",
    etag: ev.etag ?? null,
    meetUrl: meet.url,
    meetState: meet.state,
    meetError: meet.error,
  };
}

export function createGoogleCalendarProvider(
  correlationId?: string,
  options: GoogleCalendarProviderOptions = {}
): CalendarProvider {
  const retries = options.maxRetries ?? 2;

  async function authHeaders(
    extra: Record<string, string> = {}
  ): Promise<Record<string, string>> {
    const { accessToken } = await getAccessToken(correlationId);
    return { Authorization: `Bearer ${accessToken}`, Accept: "application/json", ...extra };
  }

  function eventsUrl(calendarId: string, suffix = ""): string {
    return `${BASE}/${encodeURIComponent(calendarId)}/events${suffix}`;
  }

  async function getReflected(desired: DesiredEvent): Promise<ReflectedEvent> {
    const id = googleEventId(desired.entityId, desired.idEpoch);
    const url = eventsUrl(
      desired.calendarId,
      `/${id}?conferenceDataVersion=1`
    );
    const ev = await withRetry(
      async () =>
        fetchJsonWithTimeout<GoogleEventResource>(url, {
          integration: "google",
          timeoutMs: TIMEOUT_MS,
          method: "GET",
          headers: await authHeaders(),
        }),
      { retries }
    );
    return reflect(ev, desired.wantsMeet);
  }

  async function create(desired: DesiredEvent): Promise<ReflectedEvent> {
    const url = eventsUrl(
      desired.calendarId,
      `?conferenceDataVersion=1&sendUpdates=${sendUpdates()}`
    );
    const body = JSON.stringify(toGoogleEventBody(desired));
    try {
      const ev = await withRetry(
        async () =>
          fetchJsonWithTimeout<GoogleEventResource>(url, {
            integration: "google",
            timeoutMs: TIMEOUT_MS,
            method: "POST",
            headers: await authHeaders({ "Content-Type": "application/json" }),
            body,
          }),
        { retries }
      );
      return reflect(ev, desired.wantsMeet);
    } catch (err) {
      // Duplicate deterministic id → the event already exists (a prior attempt
      // succeeded). Adopt it instead of failing. Idempotent create.
      if (err instanceof IntegrationApiError && err.status === 409) {
        return getReflected(desired);
      }
      throw err;
    }
  }

  async function update(
    desired: DesiredEvent,
    ref: EventRef
  ): Promise<ReflectedEvent> {
    const url = eventsUrl(
      desired.calendarId,
      `/${encodeURIComponent(ref.eventId)}?conferenceDataVersion=1&sendUpdates=${sendUpdates()}`
    );
    const body = JSON.stringify(toGoogleEventBody(desired));
    const patch = (useEtag: boolean) =>
      withRetry(
        async () =>
          fetchJsonWithTimeout<GoogleEventResource>(url, {
            integration: "google",
            timeoutMs: TIMEOUT_MS,
            method: "PATCH",
            headers: await authHeaders({
              "Content-Type": "application/json",
              ...(useEtag && ref.etag ? { "If-Match": ref.etag } : {}),
            }),
            body,
          }),
        { retries }
      );
    try {
      return reflect(await patch(true), desired.wantsMeet);
    } catch (err) {
      if (err instanceof IntegrationApiError && err.status === 412) {
        // Etag drift: someone edited the event in Google. Portal wins — overwrite.
        return reflect(await patch(false), desired.wantsMeet);
      }
      if (err instanceof IntegrationApiError && (err.status === 404 || err.status === 410)) {
        // Deleted in Google but alive in Portal → recreate (same deterministic id).
        return create(desired);
      }
      throw err;
    }
  }

  async function del(ref: { eventId: string; calendarId: string }): Promise<void> {
    const url = eventsUrl(
      ref.calendarId,
      `/${encodeURIComponent(ref.eventId)}?sendUpdates=${sendUpdates()}`
    );
    await withRetry(
      async () => {
        const res = await fetchWithTimeout(url, {
          integration: "google",
          timeoutMs: TIMEOUT_MS,
          method: "DELETE",
          headers: await authHeaders(),
        });
        if (res.status === 404 || res.status === 410) return; // already gone
        if (!res.ok) {
          const b = await res.text().catch(() => "");
          throw new IntegrationApiError("google", res.status, b);
        }
      },
      { retries }
    );
  }

  async function reconcile(
    desired: DesiredEvent,
    current: { googleEventId: string | null; etag: string | null }
  ): Promise<ProviderOutcome> {
    if (desired.intent === "deleted" || desired.intent === "cancelled") {
      if (current.googleEventId) {
        // Cancel first (so attendees are notified per sendUpdates), then remove.
        if (desired.intent === "cancelled") {
          await update(desired, { eventId: current.googleEventId, etag: current.etag });
        }
        await del({ eventId: current.googleEventId, calendarId: desired.calendarId });
      }
      return { kind: "deleted" };
    }
    if (current.googleEventId) {
      return {
        kind: "projected",
        event: await update(desired, {
          eventId: current.googleEventId,
          etag: current.etag,
        }),
      };
    }
    return { kind: "projected", event: await create(desired) };
  }

  return { create, update, delete: del, reconcile };
}
