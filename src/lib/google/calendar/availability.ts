import "server-only";
import { fetchJsonWithTimeout, withRetry, IntegrationConfigError } from "@/lib/net";
import { getGoogleConfig } from "@/lib/google/config";
import { getCachedAccessToken } from "./token-cache";
import type { TimeInterval } from "@/lib/planner/meetings/availability";

/**
 * Standalone READ path over the connected agency calendar for availability
 * checking (Slice D). Deliberately NOT the FreeBusy API and NOT a new scope —
 * the existing `calendar.events` grant already permits `events.list`. It does
 * not touch the CalendarProvider / projection / reconcile architecture; it only
 * reads busy intervals so the reschedule engine can intersect them.
 *
 * Built on the same net primitives as the provider: hard per-call timeout +
 * retry on transient failures, typed IntegrationError on terminal failures.
 * Callers MUST fail closed (offer no slots) if this throws — never fall back to
 * Portal-only availability.
 */

const BASE = "https://www.googleapis.com/calendar/v3/calendars";
const TIMEOUT_MS = 8000;
const MAX_PAGES = 10; // safety bound; each page is up to 2500 events

interface GoogleListEvent {
  status?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}
interface GoogleListResponse {
  items?: GoogleListEvent[];
  nextPageToken?: string;
}

/**
 * A Google event counts as BUSY unless it is cancelled or explicitly marked
 * "free" (transparency === "transparent"). singleEvents=true means recurring
 * series arrive pre-expanded into concrete instances, so each item is a real
 * occupied interval.
 */
function isBusy(ev: GoogleListEvent): boolean {
  if (ev.status === "cancelled") return false;
  if (ev.transparency === "transparent") return false;
  return true;
}

/**
 * Convert a Google event's start/end into an absolute interval. Timed events use
 * dateTime directly. All-day events (date only) are treated as busy for the
 * whole local day in `tz` — conservative, so an all-day block can't leak a slot.
 */
function toInterval(ev: GoogleListEvent, tz: string): TimeInterval | null {
  const s = ev.start ?? {};
  const e = ev.end ?? {};
  if (s.dateTime && e.dateTime) {
    return { startsAt: new Date(s.dateTime).toISOString(), endsAt: new Date(e.dateTime).toISOString() };
  }
  if (s.date && e.date) {
    // All-day: [start 00:00, end 00:00) in the meeting's zone. Google's end.date
    // is already exclusive (the morning after), so no +1 is needed.
    const startMs = Date.parse(`${s.date}T00:00:00${tzOffset(s.date, tz)}`);
    const endMs = Date.parse(`${e.date}T00:00:00${tzOffset(e.date, tz)}`);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
    return { startsAt: new Date(startMs).toISOString(), endsAt: new Date(endMs).toISOString() };
  }
  return null;
}

/** `±HH:MM` offset string for local midnight of `dateYmd` in `tz`. */
function tzOffset(dateYmd: string, tz: string): string {
  const asUTC = Date.parse(`${dateYmd}T00:00:00Z`);
  const tzT = Date.parse(new Date(asUTC).toLocaleString("en-US", { timeZone: tz }));
  const utcT = Date.parse(new Date(asUTC).toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMin = Math.round((tzT - utcT) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * Busy intervals on the connected agency calendar within [timeMinIso,
 * timeMaxIso). Expands recurrences (singleEvents), hides cancelled/deleted, and
 * follows nextPageToken. Throws IntegrationConfigError when Google isn't
 * configured and the underlying IntegrationError on any API/timeout/auth failure
 * — the caller fails closed on ANY throw.
 */
export async function listBusyIntervals(opts: {
  timeMinIso: string;
  timeMaxIso: string;
  tz: string;
  correlationId?: string;
}): Promise<TimeInterval[]> {
  const cfg = getGoogleConfig();
  if (!cfg) throw new IntegrationConfigError("google", "Google Calendar is not configured");

  const intervals: TimeInterval[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const params = new URLSearchParams({
      timeMin: opts.timeMinIso,
      timeMax: opts.timeMaxIso,
      singleEvents: "true",
      orderBy: "startTime",
      showDeleted: "false",
      maxResults: "2500",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const url = `${BASE}/${encodeURIComponent(cfg.calendarId)}/events?${params.toString()}`;

    const accessToken = await getCachedAccessToken(opts.correlationId);
    const data = await withRetry(
      () =>
        fetchJsonWithTimeout<GoogleListResponse>(url, {
          integration: "google",
          timeoutMs: TIMEOUT_MS,
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        }),
      { retries: 2 }
    );

    for (const ev of data.items ?? []) {
      if (!isBusy(ev)) continue;
      const interval = toInterval(ev, opts.tz);
      if (interval) intervals.push(interval);
    }
    pageToken = data.nextPageToken;
    pages += 1;
  } while (pageToken && pages < MAX_PAGES);

  return intervals;
}
