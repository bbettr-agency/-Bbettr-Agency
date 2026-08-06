/**
 * Team View — pure, page-agnostic board logic (NO I/O, NO server-only, NO clock).
 *
 * This module is imported by BOTH the server read model (initial render) and the
 * client filter island (re-derivation on filter change), so it must stay pure and
 * deterministic — every date fact (`today`, week bounds, overdue) is injected, so
 * server SSR and client hydration compute byte-identical output (no hydration
 * drift). It never sees a raw `Task` at the client: the server projects tasks into
 * presentation-safe `TeamTaskFacet`s first (`toFacet`).
 *
 * Honesty rules encoded here (locked product decisions):
 *   - Capacity is NEVER a percentage and NEVER inferred from task count. Estimated
 *     workload sums `estimated_minutes` ONLY over active, actionable (non-waiting)
 *     tasks that actually carry an estimate; `noEstimateCount` is always surfaced;
 *     when nothing in scope has an estimate, minutes is null ("No estimates yet").
 *   - Current focus is deterministic: overdue actionable → else in-progress → else
 *     highest-priority active. A waiting/blocked task is NEVER the current focus.
 *   - Clients are grouped by real `client_id` only; null → "Internal / No client".
 */
import type { Task, TaskPriority } from "@/lib/database.types";
import { isOverdue as deriveOverdue } from "@/lib/planner/tasks/today-membership";

/** Active lifecycle statuses Team View operates over (inbox + terminal excluded). */
export type ActiveTaskStatus = "planned" | "scheduled" | "in_progress" | "waiting";
const ACTIVE_STATUS_ORDER: ActiveTaskStatus[] = ["planned", "scheduled", "in_progress", "waiting"];

export const INTERNAL_CLIENT_LABEL = "Internal / No client";

/**
 * Presentation-safe per-task facet — the Team view model the client filter island
 * consumes. Carries NO raw row, description or privileged field. `memberId` is the
 * responsible admin: assignee when present (who is doing it now), else owner.
 */
export interface TeamTaskFacet {
  id: string;
  title: string;
  status: ActiveTaskStatus;
  priority: TaskPriority;
  memberId: string;
  memberName: string;
  clientId: string | null;
  clientName: string | null; // null → grouped under Internal / No client
  isOverdue: boolean;
  isScheduledToday: boolean;
  isThisWeek: boolean; // scheduled within the agency week (overdue handled by filter)
  isActionable: boolean; // status !== 'waiting'
  estimatedMinutes: number | null;
}

/** Per-member meta the facets can't carry (next scheduled meeting). */
export interface MemberMeta {
  id: string;
  name: string;
  nextMeeting: { title: string; whenLabel: string } | null;
}

/** Estimate rollup. `estimatedMinutes` is null when NO in-scope task has an estimate. */
export interface EstimateSummary {
  estimatedMinutes: number | null;
  noEstimateCount: number;
}

/** Deterministic "current focus" — a safe subset of a facet; never a waiting task. */
export interface FocusTask {
  id: string;
  title: string;
  status: ActiveTaskStatus;
  priority: TaskPriority;
  isOverdue: boolean;
}

export interface MemberWorkload {
  id: string;
  name: string;
  active: number;
  scheduledToday: number;
  overdue: number;
  inProgress: number;
  waiting: number;
  estimate: EstimateSummary;
  currentFocus: FocusTask | null;
  nextMeeting: { title: string; whenLabel: string } | null;
}

export interface ClientWorkload {
  clientId: string | null; // null → Internal / No client
  name: string;
  active: number;
  overdue: number;
  assignees: string[]; // distinct member names, sorted
  statuses: ActiveTaskStatus[]; // distinct, canonical order
  estimate: EstimateSummary;
}

export interface TeamSummary {
  members: number;
  activeTasks: number;
  overdueTasks: number;
  completedToday: number;
  meetingsToday: number;
}

export type WorkFilter = "active" | "overdue" | "today" | "this_week";

export interface TeamBoardFilter {
  memberId: string | "all";
  work: WorkFilter;
  search: string;
}

export interface TeamBoard {
  members: MemberWorkload[];
  clients: ClientWorkload[];
}

/** Lower rank = higher priority. Deterministic tiebreak for focus + sorting. */
const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };

/**
 * Project one active Task into a presentation-safe facet. Returns null when the
 * task has no responsible admin (inbox/ownerless — never shown on Team View) or a
 * non-active status. Pure: all date facts are injected.
 */
export function toFacet(
  task: Task,
  nameById: ReadonlyMap<string, string>,
  clientNameById: ReadonlyMap<string, string>,
  today: string,
  weekStart: string,
  weekEnd: string
): TeamTaskFacet | null {
  const status = task.status;
  if (status !== "planned" && status !== "scheduled" && status !== "in_progress" && status !== "waiting") {
    return null;
  }
  const memberId = task.assignee_id ?? task.owner_user_id;
  if (!memberId) return null; // ownerless intake — not a team-member workload item

  const clientName = task.client_id != null ? clientNameById.get(task.client_id) ?? null : null;
  const scheduled = task.scheduled_date;
  return {
    id: task.id,
    title: task.title,
    status,
    priority: task.priority,
    memberId,
    memberName: nameById.get(memberId) ?? "Unknown",
    clientId: task.client_id,
    clientName,
    isOverdue: deriveOverdue(task, today),
    isScheduledToday: scheduled === today,
    isThisWeek: scheduled != null && scheduled >= weekStart && scheduled <= weekEnd,
    isActionable: status !== "waiting",
    estimatedMinutes: task.estimated_minutes,
  };
}

/**
 * Estimate rollup over a facet set. Scope is ACTIONABLE (non-waiting) tasks only,
 * per the capacity ruling. minutes is null when none in scope carry an estimate.
 */
export function summarizeEstimates(facets: readonly TeamTaskFacet[]): EstimateSummary {
  const actionable = facets.filter((f) => f.isActionable);
  const withEstimate = actionable.filter((f) => f.estimatedMinutes != null);
  return {
    estimatedMinutes: withEstimate.length === 0 ? null : withEstimate.reduce((s, f) => s + (f.estimatedMinutes ?? 0), 0),
    noEstimateCount: actionable.length - withEstimate.length,
  };
}

/** Deterministic tiebreak: higher priority first, then stable by id. */
function byPriorityThenId(a: TeamTaskFacet, b: TeamTaskFacet): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Deterministic current focus: overdue actionable → else in-progress → else the
 * highest-priority active task. A waiting/blocked task is never chosen.
 */
export function pickCurrentFocus(facets: readonly TeamTaskFacet[]): FocusTask | null {
  const actionable = facets.filter((f) => f.isActionable);
  const overdue = actionable.filter((f) => f.isOverdue).sort(byPriorityThenId);
  const inProgress = actionable.filter((f) => f.status === "in_progress").sort(byPriorityThenId);
  const chosen = overdue[0] ?? inProgress[0] ?? [...actionable].sort(byPriorityThenId)[0] ?? null;
  if (!chosen) return null;
  return { id: chosen.id, title: chosen.title, status: chosen.status, priority: chosen.priority, isOverdue: chosen.isOverdue };
}

function buildMemberWorkload(member: MemberMeta, facets: readonly TeamTaskFacet[]): MemberWorkload {
  return {
    id: member.id,
    name: member.name,
    active: facets.length,
    scheduledToday: facets.filter((f) => f.isScheduledToday).length,
    overdue: facets.filter((f) => f.isOverdue).length,
    inProgress: facets.filter((f) => f.status === "in_progress").length,
    waiting: facets.filter((f) => f.status === "waiting").length,
    estimate: summarizeEstimates(facets),
    currentFocus: pickCurrentFocus(facets),
    nextMeeting: member.nextMeeting,
  };
}

/** Distinct statuses of a group, returned in the canonical active order. */
function distinctStatuses(facets: readonly TeamTaskFacet[]): ActiveTaskStatus[] {
  const present = new Set(facets.map((f) => f.status));
  return ACTIVE_STATUS_ORDER.filter((s) => present.has(s));
}

/**
 * Group facets by REAL client_id. null client_id collects under Internal / No
 * client, which always sorts last. Real clients sort busiest-first (active desc,
 * then overdue desc, then name).
 */
export function buildClientWorkloads(facets: readonly TeamTaskFacet[]): ClientWorkload[] {
  const groups = new Map<string, TeamTaskFacet[]>();
  for (const f of facets) {
    const key = f.clientId ?? "__internal__";
    const list = groups.get(key);
    if (list) list.push(f);
    else groups.set(key, [f]);
  }

  const out: ClientWorkload[] = [];
  for (const [key, list] of groups) {
    const isInternal = key === "__internal__";
    out.push({
      clientId: isInternal ? null : key,
      name: isInternal ? INTERNAL_CLIENT_LABEL : list[0].clientName ?? INTERNAL_CLIENT_LABEL,
      active: list.length,
      overdue: list.filter((f) => f.isOverdue).length,
      assignees: [...new Set(list.map((f) => f.memberName))].sort((a, b) => a.localeCompare(b)),
      statuses: distinctStatuses(list),
      estimate: summarizeEstimates(list),
    });
  }

  return out.sort((a, b) => {
    // Internal / No client always last.
    if (a.clientId === null) return 1;
    if (b.clientId === null) return -1;
    return b.active - a.active || b.overdue - a.overdue || a.name.localeCompare(b.name);
  });
}

/** Does a facet satisfy the work-slice filter? Overdue is folded into today/week. */
function matchesWork(f: TeamTaskFacet, work: WorkFilter): boolean {
  switch (work) {
    case "active":
      return true;
    case "overdue":
      return f.isOverdue;
    case "today":
      return f.isScheduledToday || f.isOverdue;
    case "this_week":
      return f.isThisWeek || f.isOverdue;
  }
}

/** Apply member + work + search filters to the facet set (case-insensitive search). */
export function applyFilter(facets: readonly TeamTaskFacet[], filter: TeamBoardFilter): TeamTaskFacet[] {
  const term = filter.search.trim().toLowerCase();
  return facets.filter((f) => {
    if (filter.memberId !== "all" && f.memberId !== filter.memberId) return false;
    if (!matchesWork(f, filter.work)) return false;
    if (term.length > 0) {
      const hay = `${f.title} ${f.memberName} ${f.clientName ?? INTERNAL_CLIENT_LABEL}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });
}

/**
 * Compute the filtered board (member cards + client groups). Member visibility:
 * under the default Active view (no member filter, no search) EVERY member card is
 * shown — including those with zero active tasks, so "who has capacity" is visible.
 * Under a narrowing filter (overdue/today/this-week, a search term) only members
 * with matching work are shown. An explicit member selection always shows that one
 * card. Members sort busiest-first (active desc, overdue desc, name).
 */
export function computeBoard(facets: readonly TeamTaskFacet[], members: readonly MemberMeta[], filter: TeamBoardFilter): TeamBoard {
  const filtered = applyFilter(facets, filter);
  const byMember = new Map<string, TeamTaskFacet[]>();
  for (const f of filtered) {
    const list = byMember.get(f.memberId);
    if (list) list.push(f);
    else byMember.set(f.memberId, [f]);
  }

  const showEmpty = filter.memberId !== "all" || (filter.work === "active" && filter.search.trim() === "");
  const selected = filter.memberId === "all" ? members : members.filter((m) => m.id === filter.memberId);

  const memberCards = selected
    .map((m) => ({ m, facets: byMember.get(m.id) ?? [] }))
    .filter((x) => showEmpty || x.facets.length > 0)
    .map((x) => buildMemberWorkload(x.m, x.facets))
    .sort((a, b) => b.active - a.active || b.overdue - a.overdue || a.name.localeCompare(b.name));

  return { members: memberCards, clients: buildClientWorkloads(filtered) };
}

/** Static workspace summary (unaffected by filters — a fixed operational snapshot). */
export function buildSummary(
  allFacets: readonly TeamTaskFacet[],
  membersCount: number,
  completedToday: number,
  meetingsToday: number
): TeamSummary {
  return {
    members: membersCount,
    activeTasks: allFacets.length,
    overdueTasks: allFacets.filter((f) => f.isOverdue).length,
    completedToday,
    meetingsToday,
  };
}

/** Format estimated workload minutes as a compact "Xh Ym" / "Ym" label. Pure. */
export function formatWorkload(minutes: number): string {
  if (minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
