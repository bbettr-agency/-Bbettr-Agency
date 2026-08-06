import "server-only";

/**
 * Team View server read model. Authenticated + RLS-scoped — NO service-role
 * client. Produces presentation-safe view models only (active facets, completed
 * facets, summary, member meta); a raw `Task` never leaves this module.
 *
 * Query budget (all workspace-bounded, no N+1):
 *   1) one active-task read  — every admin's active tasks (RLS scopes workspace)
 *   2) one completed-today read (bounded, then filtered to the agency day)
 *   3) one admin-team read (workspace-scoped via listAdminTeam)
 *   4) one meetings read (reused listMeetings)
 *   5) one batched client-name read (client_ids present across active + completed)
 * Reads 1–4 run in parallel; the client-name read depends on (1)+(2)'s ids.
 *
 * The tasks table's admin+workspace RLS returns EVERY admin's tasks (there is no
 * owner/assignee predicate), so a single query yields the whole team's workload.
 * Level-2 detail (Today/Upcoming/Waiting/Clients) is a pure CLIENT-side re-group
 * of these facets on expand — no extra fetch.
 */
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isTasksEnabled } from "@/lib/flags";
import { AGENCY_TZ, formatDayLabel, formatTimeInZone, localDate, todayDate, weekRange } from "@/lib/planner/meetings/date-views";
import { listMeetings } from "@/lib/planner/meetings/queries";
import { scheduledMeetings, meetingsTodayCount } from "@/lib/planner/meetings/meeting-metrics";
import { listAdminTeam } from "@/lib/planner/team";
import { TaskError } from "@/lib/planner/tasks/errors";
import { toFacet, buildSummary, type MemberMeetingLite, type MemberMeta, type TeamSummary, type TeamTaskFacet } from "./team-board";
import type { CompletedFacet } from "./team-detail";
import type { Task, TaskStatus } from "@/lib/database.types";

/** Active lifecycle statuses Team View operates over (inbox intake + terminal excluded). */
const ACTIVE_STATUSES: TaskStatus[] = ["planned", "scheduled", "in_progress", "waiting"];
/** Bound the per-member meetings list (Level-2 section) to keep the payload small. */
const MAX_MEMBER_MEETINGS = 5;

/** The columns of a completed task we project into a CompletedFacet. */
type CompletedRow = Pick<Task, "id" | "title" | "owner_user_id" | "assignee_id" | "client_id" | "completed_at">;

export interface TeamViewData {
  today: string; // agency-local YYYY-MM-DD (drives overdue + hydration-stable flags)
  summary: TeamSummary;
  facets: TeamTaskFacet[]; // active tasks (workload)
  completed: CompletedFacet[]; // completed today (for the Level-2 "Completed today" section)
  members: MemberMeta[];
}

export async function getTeamViewData(now: Date = new Date()): Promise<TeamViewData> {
  if (!isTasksEnabled()) throw new TaskError("TasksDisabled");
  const profile = await getCurrentProfile();
  if (!profile) throw new TaskError("NotAuthenticated");
  if (profile.role !== "admin") throw new TaskError("NotAuthorized");
  const supabase = await createClient();

  const today = todayDate(now, AGENCY_TZ);
  const { start: weekStart, end: weekEnd } = weekRange(now, AGENCY_TZ);
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

  const [activeRes, doneRes, team, meetings] = await Promise.all([
    supabase
      .from("tasks")
      .select("*")
      .is("deleted_at", null)
      .in("status", ACTIVE_STATUSES)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("scheduled_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("tasks")
      .select("id, title, owner_user_id, assignee_id, client_id, completed_at")
      .is("deleted_at", null)
      .eq("status", "completed")
      .gte("completed_at", twoDaysAgo),
    // Pass the workspace we already hold (profile is React-cached) so team
    // resolution is a single profiles query — no redundant current_workspace_id RPC.
    listAdminTeam(profile.workspace_id),
    listMeetings(),
  ]);
  if (activeRes.error || doneRes.error) throw new TaskError("PersistenceError");

  const activeTasks = (activeRes.data ?? []) as Task[];
  const completedToday = ((doneRes.data ?? []) as CompletedRow[]).filter(
    (r) => r.completed_at != null && localDate(r.completed_at, AGENCY_TZ) === today
  );

  // ── Batched client-name resolution: ONE query over ids present across BOTH sets ──
  const clientIds = [
    ...new Set(
      [...activeTasks, ...completedToday].map((t) => t.client_id).filter((id): id is string => id != null)
    ),
  ];
  const clientNameById = new Map<string, string>();
  if (clientIds.length > 0) {
    const { data: clientRows, error: clientErr } = await supabase.from("clients").select("id, name").in("id", clientIds);
    if (clientErr) throw new TaskError("PersistenceError");
    for (const c of clientRows ?? []) clientNameById.set(c.id, c.name);
  }

  const nameById = new Map(team.map((m) => [m.id, m.fullName]));

  const facets: TeamTaskFacet[] = [];
  for (const t of activeTasks) {
    const f = toFacet(t, nameById, clientNameById, today, weekStart, weekEnd);
    if (f) facets.push(f);
  }

  const completed: CompletedFacet[] = [];
  for (const r of completedToday) {
    const memberId = r.assignee_id ?? r.owner_user_id;
    if (!memberId || r.completed_at == null) continue;
    completed.push({
      id: r.id,
      title: r.title,
      memberId,
      memberName: nameById.get(memberId) ?? "Unknown",
      clientId: r.client_id,
      clientName: r.client_id != null ? clientNameById.get(r.client_id) ?? null : null,
      completedAt: r.completed_at,
      completedAtLabel: formatTimeInZone(r.completed_at, AGENCY_TZ),
    });
  }

  // ── Per-member scheduled meetings — created_by is the SCHEDULER (the one shared
  // agency calendar has no attendee model), so this is scheduled-by, NOT attendance.
  // Bounded to the next few upcoming; nextMeeting is the first. ─────────────────
  const scheduled = scheduledMeetings(meetings);
  const label = (startsAt: string): string =>
    `${formatDayLabel(localDate(startsAt, AGENCY_TZ), now, AGENCY_TZ)} · ${formatTimeInZone(startsAt, AGENCY_TZ)}`;
  const members: MemberMeta[] = team.map((m) => {
    const mine: MemberMeetingLite[] = scheduled
      .filter((mt) => mt.created_by === m.id && new Date(mt.starts_at).getTime() >= now.getTime())
      .sort((a, b) => (a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : 0))
      .slice(0, MAX_MEMBER_MEETINGS)
      .map((mt) => ({ title: mt.title, whenLabel: label(mt.starts_at) }));
    return { id: m.id, name: m.fullName, nextMeeting: mine[0] ?? null, meetings: mine };
  });

  const meetingsToday = meetingsTodayCount(meetings, now, AGENCY_TZ);
  // Headline "Completed today" counts EVERY completed-today row, independent of
  // member resolution (a completed task always has an owner per the
  // owner-beyond-inbox constraint, but the summary must not silently drop one).
  const summary = buildSummary(facets, members.length, completedToday.length, meetingsToday);
  return { today, summary, facets, completed, members };
}
