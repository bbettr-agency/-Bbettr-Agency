/**
 * Pure activity-timeline presentation logic (Slice 2B) — no I/O, no JSX.
 *
 * The activity_events system and its data are untouched: this only controls how
 * the admin Work timeline is PRESENTED. Two jobs:
 *   1. Collapse runs of consecutive, same-visibility file uploads into a single
 *      "N files uploaded" row so upload spam stops dominating the timeline.
 *   2. Select the recent slice and report whether more rows exist.
 *
 * Full history is rendered UNGROUPED elsewhere, so no event is ever destroyed or
 * made unreachable by this compression — grouping is display-only.
 */

export interface ActivityEventLike {
  id: string;
  type: string;
  title: string;
  description: string | null;
  visibility: string;
  occurred_at: string;
  source: string;
}

/** Event types that are safe to collapse when they occur back-to-back. */
export const GROUPABLE_TYPES: ReadonlySet<string> = new Set(["file_uploaded"]);

export type ActivityRowModel =
  | { kind: "event"; id: string; event: ActivityEventLike }
  | {
      kind: "file_group";
      id: string;
      count: number;
      occurred_at: string;
      visibility: string;
      /** The underlying events, newest-first — preserved for completeness. */
      events: ActivityEventLike[];
    };

/**
 * Build display rows from a newest-first event list. Consecutive groupable
 * events that share a visibility collapse into one file_group row (only when a
 * run has 2+ members — a lone upload stays a normal event row). Every other
 * event is its own row. Order is preserved; no event is dropped.
 */
export function buildActivityRows(events: ActivityEventLike[]): ActivityRowModel[] {
  const rows: ActivityRowModel[] = [];
  let buf: ActivityEventLike[] = [];

  const flush = () => {
    if (buf.length === 0) return;
    if (buf.length >= 2) {
      rows.push({
        kind: "file_group",
        id: `group:${buf[0].id}`,
        count: buf.length,
        occurred_at: buf[0].occurred_at,
        visibility: buf[0].visibility,
        events: buf,
      });
    } else {
      rows.push({ kind: "event", id: buf[0].id, event: buf[0] });
    }
    buf = [];
  };

  for (const ev of events) {
    if (GROUPABLE_TYPES.has(ev.type)) {
      if (buf.length > 0 && buf[0].visibility !== ev.visibility) flush();
      buf.push(ev);
    } else {
      flush();
      rows.push({ kind: "event", id: ev.id, event: ev });
    }
  }
  flush();
  return rows;
}

/** How many underlying events a row represents (1 for a normal event). */
export function rowEventCount(row: ActivityRowModel): number {
  return row.kind === "file_group" ? row.count : 1;
}

export interface RecentActivityView {
  rows: ActivityRowModel[];
  /** True when grouping still leaves more rows than the recent limit shows. */
  hasMoreRows: boolean;
}

/**
 * The recent view: the first `limit` display rows, plus whether more rows exist
 * beyond them. Callers combine `hasMoreRows` with a "the bounded fetch was
 * capped" signal to decide whether to offer "View full history".
 */
export function selectRecent(
  events: ActivityEventLike[],
  limit: number
): RecentActivityView {
  const all = buildActivityRows(events);
  return { rows: all.slice(0, limit), hasMoreRows: all.length > limit };
}

/** Recent-view row budget for the admin Work timeline. */
export const ADMIN_RECENT_ROWS = 8;
/** Bounded initial fetch for the admin Work timeline (fast first paint). */
export const ADMIN_RECENT_FETCH = 30;
/** Client Home shows this many recent client-visible events by default. */
export const CLIENT_HOME_RECENT = 5;
/** Bounded client Home activity fetch (preview depth, expandable client-side). */
export const CLIENT_HOME_FETCH = 15;
