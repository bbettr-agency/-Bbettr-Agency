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
/** A real client_id whose name could not be resolved (theoretical; FK keeps it live). */
export const UNKNOWN_CLIENT_LABEL = "Unknown client";

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
      // Real client with an unresolved name → "Unknown client", never conflated
      // with the null-client Internal bucket.
      name: isInternal ? INTERNAL_CLIENT_LABEL : list[0].clientName ?? UNKNOWN_CLIENT_LABEL,
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
 * Compute the filtered board (member cards + client groups).
 *
 * HONESTY INVARIANT: every displayed number is a TRUE total. The team-member
 * filter is a hard data scope (whose world you are looking at); the work slice
 * (overdue/today/this-week) and search are VISIBILITY-ONLY — they decide which
 * cards/groups appear, never recompute a card's counts. So a member card under
 * the Overdue filter still shows the member's real active/in-progress/etc. totals
 * (their full load), not just their overdue count — which is what "who is
 * overloaded / who has capacity" actually needs.
 *
 * Visibility: under the default Active view (Everyone, no search) EVERY member
 * card shows — including zero-task members, so capacity is visible. Under a
 * narrowing slice or a search term, only members/clients WITH matching work show.
 * An explicit member selection always shows that one card. Members sort
 * busiest-first (active desc, overdue desc, name).
 */
export function computeBoard(facets: readonly TeamTaskFacet[], members: readonly MemberMeta[], filter: TeamBoardFilter): TeamBoard {
  // Member filter = hard data scope; stats/focus are computed from this set.
  const scoped = filter.memberId === "all" ? facets : facets.filter((f) => f.memberId === filter.memberId);
  // Visibility set = scoped ∩ (work + search). Used ONLY to decide what appears.
  const visible = applyFilter(facets, filter);
  const visibleMemberIds = new Set(visible.map((f) => f.memberId));
  const visibleClientKeys = new Set(visible.map((f) => f.clientId ?? "__internal__"));

  const scopedByMember = new Map<string, TeamTaskFacet[]>();
  for (const f of scoped) {
    const list = scopedByMember.get(f.memberId);
    if (list) list.push(f);
    else scopedByMember.set(f.memberId, [f]);
  }

  const showAll = filter.work === "active" && filter.search.trim() === "";
  const selected = filter.memberId === "all" ? members : members.filter((m) => m.id === filter.memberId);

  const memberCards = selected
    // An explicit member selection always shows; otherwise show-all (Active view)
    // or only members that have work matching the narrowing filter.
    .filter((m) => filter.memberId !== "all" || showAll || visibleMemberIds.has(m.id))
    .map((m) => buildMemberWorkload(m, scopedByMember.get(m.id) ?? [])) // TRUE totals
    .sort((a, b) => b.active - a.active || b.overdue - a.overdue || a.name.localeCompare(b.name));

  const allClients = buildClientWorkloads(scoped); // TRUE per-client totals (member-scoped)
  const clients = showAll ? allClients : allClients.filter((c) => visibleClientKeys.has(c.clientId ?? "__internal__"));

  return { members: memberCards, clients };
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
