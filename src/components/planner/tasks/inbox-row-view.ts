/**
 * Pure presentation mapper for one Inbox row (no I/O, no ambient clock).
 *
 * Takes only the three fields a row needs from a Task (title, created_at,
 * created_by) plus a best-effort captured-by name and a caller-supplied `now`,
 * and returns ONLY presentation-safe values. It never receives or returns the
 * full Task object. `now` is injected so every row in one render shares a
 * consistent baseline and the tests stay deterministic. Malformed input never
 * throws — it degrades to safe fallbacks.
 */
import { formatDistance } from "date-fns";

/** The minimal Task fields a row displays. */
export interface InboxRowInput {
  title: string;
  created_at: string; // ISO instant
  created_by: string; // profile id (resolution is the caller's concern)
}

/** The presentation-safe view a row renders. */
export interface InboxRowView {
  title: string;
  /** Relative label, e.g. "about 2 hours ago" (deterministic against `now`). */
  capturedRelative: string;
  /** Best-effort admin name, or null (render without attribution). */
  capturedBy: string | null;
  /** Machine-readable ISO for `<time dateTime>` (retained verbatim). */
  capturedAtISO: string;
  /** Human absolute label for the `<time>` title (agency timezone), or "". */
  capturedAtLabel: string;
}

function absoluteLabel(d: Date): string {
  try {
    return new Intl.DateTimeFormat("en-ZA", {
      timeZone: "Africa/Johannesburg",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return "";
  }
}

export function toInboxRowView(task: InboxRowInput, capturedByName: string | null, now: Date): InboxRowView {
  const created = new Date(task.created_at);
  const valid = !Number.isNaN(created.getTime());
  const name = capturedByName != null && capturedByName.trim().length > 0 ? capturedByName.trim() : null;
  return {
    title: task.title,
    capturedRelative: valid ? formatDistance(created, now, { addSuffix: true }) : "recently",
    capturedBy: name,
    capturedAtISO: task.created_at,
    capturedAtLabel: valid ? absoluteLabel(created) : "",
  };
}
