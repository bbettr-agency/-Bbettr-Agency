import "server-only";

/**
 * Team View server read model (Slice 1). Authenticated + RLS-scoped — NO
 * service-role client. Produces presentation-safe view models only (facets +
 * summary + member meta); a raw `Task` never leaves this module.
 *
 * Query budget (all workspace-bounded, no N+1):
 *   1) one active-task read  — every admin's active tasks (RLS scopes workspace)
 *   2) one completed-today read (bounded, then filtered to the agency day)
 *   3) one admin-team read (workspace-scoped via listAdminTeam)
 *   4) one meetings read (reused listMeetings)
 *   5) one batched client-name read (only the client_ids actually present)
 * Reads 1–4 run in parallel; the client-name read depends on (1)'s ids.
 *
 * The tasks table's admin+workspace RLS returns EVERY admin's tasks (there is no
 * owner/assignee predicate), so a single query yields the whole team's workload.
 */
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isTasksEnabled } from "@/lib/flags";
import { AGENCY_TZ, formatDayLabel, formatTimeInZone, localDate, todayDate, weekRange } from "@/lib/planner/meetings/date-views";
import { listMeetings } from "@/lib/planner/meetings/queries";
import { scheduledMeetings, meetingsTodayCount, nextMeeting } from "@/lib/planner/meetings/meeting-metrics";
import { listAdminTeam } from "@/lib/planner/team";
import { TaskError } from "@/lib/planner/tasks/errors";
import { toFacet, buildSummary, type MemberMeta, type TeamSummary, type TeamTaskFacet } from "./team-board";
import type { Task, TaskStatus } from "@/lib/database.types";

/** Active lifecycle statuses Team View operates over (inbox intake + terminal excluded). */
const ACTIVE_STATUSES: TaskStatus[] = ["planned", "scheduled", "in_progress", "waiting"];

export interface TeamViewData {
  today: string; // agency-local YYYY-MM-DD (drives overdue + hydration-stable flags)
  summary: TeamSummary;
  facets: TeamTaskFacet[];
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
      .select("id, completed_at")
      .is("deleted_at", null)
      .eq("status", "completed")
      .gte("completed_at", twoDaysAgo),
    listAdminTeam(),
    listMeetings(),
  ]);
  if (activeRes.error || doneRes.error) throw new TaskError("PersistenceError");

  const activeTasks = (activeRes.data ?? []) as Task[];

  // ── Batched client-name resolution: ONE query over the ids actually present ──
  const clientIds = [...new Set(activeTasks.map((t) => t.client_id).filter((id): id is string => id != null))];
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

  // ── Per-member "next scheduled meeting" — created_by is the SCHEDULER (the one
  // shared agency calendar has no attendee model), so this is scheduled-by, not
  // attendance. Only surfaced when a real future meeting exists. ──────────────
  const scheduled = scheduledMeetings(meetings);
  const members: MemberMeta[] = team.map((m) => {
    const mineNext = nextMeeting(
      scheduled.filter((mt) => mt.created_by === m.id),
      now
    );
    const nextMeetingMeta = mineNext
      ? {
          title: mineNext.title,
          whenLabel: `${formatDayLabel(localDate(mineNext.starts_at, AGENCY_TZ), now, AGENCY_TZ)} · ${formatTimeInZone(mineNext.starts_at, AGENCY_TZ)}`,
        }
      : null;
    return { id: m.id, name: m.fullName, nextMeeting: nextMeetingMeta };
  });

  const completedToday = ((doneRes.data ?? []) as { completed_at: string | null }[]).filter(
    (r) => r.completed_at != null && localDate(r.completed_at, AGENCY_TZ) === today
  ).length;
  const meetingsToday = meetingsTodayCount(meetings, now, AGENCY_TZ);

  const summary = buildSummary(facets, members.length, completedToday, meetingsToday);
  return { today, summary, facets, members };
}
