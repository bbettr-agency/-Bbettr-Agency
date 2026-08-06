/**
 * Team View Level-2 detail — pure, client-safe partitioning (NO I/O, NO clock).
 *
 * When a member band is expanded, the client island partitions THAT member's
 * facets — already delivered by the server — into the detail sections. No fetch,
 * no round-trip: expansion is an instant re-group of presentation-safe view
 * models. This module is the deterministic, unit-tested heart of that.
 *
 * Every active task lands in exactly one of Today / Upcoming / Waiting (nothing is
 * hidden). Completed-today and the member's clients + scheduled meetings round out
 * the "everything this person is doing" view. Read-only throughout — Team View
 * never mutates a task, which is what keeps it from becoming a second My Tasks.
 */
import type { TaskPriority } from "@/lib/database.types";
import { INTERNAL_CLIENT_LABEL, type MemberMeetingLite, type TeamTaskFacet } from "./team-board";

/**
 * Presentation-safe completed-today task. `status='completed'` is outside the
 * active facet set, so completed rows get their own lightweight view model.
 */
export interface CompletedFacet {
  id: string;
  title: string;
  memberId: string;
  memberName: string;
  clientId: string | null;
  clientName: string | null;
  completedAt: string; // ISO — for deterministic ordering (client sorts by string)
  completedAtLabel: string; // pre-formatted agency-local time for display (client stays tz-free)
}

/** One client the member touches, with their active-task count for it. Internal last. */
export interface MemberClientLite {
  clientId: string | null;
  name: string;
  active: number;
}

/** The full Level-2 detail for one member. Every list is derived + deterministic. */
export interface MemberDetail {
  today: TeamTaskFacet[]; // actionable, scheduled today OR overdue
  upcoming: TeamTaskFacet[]; // actionable, not today (scheduled later or unscheduled)
  waiting: TeamTaskFacet[]; // status === 'waiting'
  completed: CompletedFacet[]; // completed today
  clients: MemberClientLite[];
  meetings: MemberMeetingLite[];
}

const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byPriorityThenId = (a: TeamTaskFacet, b: TeamTaskFacet): number =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byId(a, b);

/** Ascending scheduled date (nulls last), then priority, then id. */
function byScheduledThenPriority(a: TeamTaskFacet, b: TeamTaskFacet): number {
  const ad = a.scheduledDate;
  const bd = b.scheduledDate;
  if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;
  if (ad && !bd) return -1;
  if (!ad && bd) return 1;
  return byPriorityThenId(a, b);
}

/** Today ordering: overdue first (by due date), then scheduled-today by priority. */
function byTodayUrgency(a: TeamTaskFacet, b: TeamTaskFacet): number {
  if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
  if (a.isOverdue && b.isOverdue) {
    const ad = a.dueDate;
    const bd = b.dueDate;
    if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;
  }
  return byPriorityThenId(a, b);
}

/** Distinct clients the member touches (from active facets), with counts. Internal last. */
function memberClients(active: readonly TeamTaskFacet[]): MemberClientLite[] {
  const byKey = new Map<string, MemberClientLite>();
  for (const f of active) {
    const key = f.clientId ?? "__internal__";
    const existing = byKey.get(key);
    if (existing) existing.active += 1;
    else byKey.set(key, { clientId: f.clientId, name: f.clientId == null ? INTERNAL_CLIENT_LABEL : f.clientName ?? "Unknown client", active: 1 });
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.clientId === null) return 1; // Internal / No client last
    if (b.clientId === null) return -1;
    return b.active - a.active || a.name.localeCompare(b.name);
  });
}

/**
 * Partition ONE member's active facets + completed facets into the Level-2
 * sections. `active`/`completed` must already be scoped to the member. Pure.
 */
export function buildMemberDetail(
  active: readonly TeamTaskFacet[],
  completed: readonly CompletedFacet[],
  meetings: readonly MemberMeetingLite[]
): MemberDetail {
  const actionable = active.filter((f) => f.isActionable);
  const today = actionable.filter((f) => f.isScheduledToday || f.isOverdue).sort(byTodayUrgency);
  const todayIds = new Set(today.map((f) => f.id));
  const upcoming = actionable.filter((f) => !todayIds.has(f.id)).sort(byScheduledThenPriority);
  const waiting = active.filter((f) => f.status === "waiting").sort(byPriorityThenId);
  const completedSorted = [...completed].sort((a, b) => (a.completedAt > b.completedAt ? -1 : a.completedAt < b.completedAt ? 1 : byId(a, b)));
  return { today, upcoming, waiting, completed: completedSorted, clients: memberClients(active), meetings: [...meetings] };
}
