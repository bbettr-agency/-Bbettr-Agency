/**
 * Derived post-meeting lifecycle (0054). PURE and I/O-free — the single source
 * of truth that maps the stored annotations to one of five states. Completion is
 * an annotation (attended_at), never a stored status, so the states are DERIVED:
 *
 *   precedence: cancelled → no_show → completed → needs_outcome → upcoming
 *
 * All time reasoning is instant-based (ends_at vs now), so it is timezone- and
 * DST-independent.
 */

export type MeetingLifecycleState =
  | "upcoming"
  | "needs_outcome"
  | "completed"
  | "no_show"
  | "cancelled";

export interface LifecycleFields {
  status: "scheduled" | "cancelled";
  no_show_at: string | null;
  attended_at: string | null;
  ends_at: string; // ISO instant
}

/**
 * Derive the lifecycle state. `now` is injectable for deterministic tests and
 * server rendering. The `ends_at == now` boundary resolves to `needs_outcome`
 * (a meeting whose end instant has arrived is over and awaiting an outcome).
 */
export function deriveMeetingState(
  m: LifecycleFields,
  now: Date = new Date()
): MeetingLifecycleState {
  if (m.status === "cancelled") return "cancelled";
  if (m.no_show_at) return "no_show";
  if (m.attended_at) return "completed";
  return Date.parse(m.ends_at) <= now.getTime() ? "needs_outcome" : "upcoming";
}

/** Human label + badge tone for a lifecycle state (UI-facing, no I/O). */
export const LIFECYCLE_META: Record<
  MeetingLifecycleState,
  { label: string; tone: "brand" | "neutral" | "success" | "warning" | "danger" | "info" }
> = {
  upcoming: { label: "Upcoming", tone: "info" },
  needs_outcome: { label: "Needs outcome", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  no_show: { label: "No-show", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** Tab order for the Calendar surface. Upcoming is the default (first). */
export const LIFECYCLE_TABS: MeetingLifecycleState[] = [
  "upcoming",
  "needs_outcome",
  "completed",
  "no_show",
  "cancelled",
];
