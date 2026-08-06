import "server-only";

/**
 * Authenticated Tasks read adapters (RLS-scoped). No privileged client is ever
 * used here — reads rely entirely on the admin+workspace RLS boundary and the
 * SECURITY DEFINER safe-read functions. Every entry point refuses while the
 * Tasks module is disabled.
 *
 * Scope (locked C1): the minimum read surface future Planner lenses need — the
 * current admin's Today slice, overdue, scheduled-today, the separate Waiting
 * set, active blockers, and safe event/reminder projections. NO ranking, Next
 * Best Action, grouping, progress, timeline or formatting — those belong to the
 * later Today product phase.
 */
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isTasksEnabled } from "@/lib/flags";
import { AGENCY_TZ, localDate, todayDate, weekRange } from "@/lib/planner/meetings/date-views";
import type { SafeTaskEvent, SafeTaskReminder, Task, TaskBlocker, TaskStatus } from "@/lib/database.types";
import { TaskError } from "./errors";
import { isOverdue, isScheduledToday, partitionToday } from "./today-membership";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** Gate + resolve the current admin. Reads are always the current admin's own tasks. */
async function authedContext(): Promise<{ supabase: SupabaseServerClient; adminId: string }> {
  if (!isTasksEnabled()) throw new TaskError("TasksDisabled");
  const profile = await getCurrentProfile();
  if (!profile) throw new TaskError("NotAuthenticated");
  if (profile.role !== "admin") throw new TaskError("NotAuthorized");
  const supabase = await createClient();
  return { supabase, adminId: profile.id };
}

const ACTIVE_STATUSES: TaskStatus[] = ["inbox", "planned", "scheduled", "in_progress", "waiting"];

export interface TodayTaskSlice {
  today: string; // agency-local YYYY-MM-DD used for membership
  queue: Task[]; // actionable Today members (excludes Waiting/completed/archived)
  waiting: Task[]; // Today members in Waiting, returned separately
  overdue: Task[]; // subset of members that are overdue
  scheduledToday: Task[]; // subset of members scheduled for today
}

/**
 * The current admin's Today task slice: `scheduled_date == today(agency)` OR
 * overdue, RLS-scoped. Completed/archived/deleted are excluded at the database;
 * Waiting is separated in-memory via the pure membership rules.
 */
export async function getTodayTaskSlice(now: Date = new Date()): Promise<TodayTaskSlice> {
  const { supabase, adminId } = await authedContext();
  const today = todayDate(now, AGENCY_TZ);

  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("assignee_id", adminId)
    .is("deleted_at", null)
    .in("status", ACTIVE_STATUSES)
    .or(`scheduled_date.eq.${today},due_date.lt.${today}`)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("scheduled_date", { ascending: true, nullsFirst: false });
  if (error) throw new TaskError("PersistenceError");

  const tasks = (data ?? []) as Task[];
  const { queue, waiting } = partitionToday(tasks, today);
  return {
    today,
    queue,
    waiting,
    overdue: tasks.filter((t) => isOverdue(t, today)),
    scheduledToday: tasks.filter((t) => isScheduledToday(t, today)),
  };
}

/**
 * The SHARED agency Inbox: every `status='inbox'` task in the current workspace,
 * newest capture first. This is the agency intake queue — it is intentionally
 * NOT filtered by created_by, owner or assignee (Inbox tasks are ownerless until
 * triaged). Workspace scoping and admin-only visibility come entirely from the
 * tasks table's admin+workspace RLS (the authenticated client); deleted rows are
 * excluded at the database.
 */
export async function getInboxTasks(): Promise<Task[]> {
  const { supabase } = await authedContext();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("status", "inbox")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new TaskError("PersistenceError");
  return (data ?? []) as Task[];
}

/** The active statuses that constitute the My Tasks workspace (Inbox is excluded — it is intake, not owned work). */
const MY_TASKS_STATUSES: TaskStatus[] = ["planned", "scheduled", "in_progress", "waiting"];

/**
 * The current admin's personal active task workspace: every non-deleted task in
 * an active status (planned/scheduled/in_progress/waiting) where the admin is the
 * OWNER or the ASSIGNEE. Inbox/completed/archived are excluded at the database.
 * RLS (admin + workspace) scopes the rows; no privileged client is used. Grouping,
 * overdue derivation and ordering are applied by the pure kit, not here.
 */
export async function getMyTasks(): Promise<Task[]> {
  const { supabase, adminId } = await authedContext();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .is("deleted_at", null)
    .in("status", MY_TASKS_STATUSES)
    .or(`owner_user_id.eq.${adminId},assignee_id.eq.${adminId}`)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("scheduled_date", { ascending: true, nullsFirst: false });
  if (error) throw new TaskError("PersistenceError");
  return (data ?? []) as Task[];
}

export interface TodayWorkspace {
  today: string; // agency-local YYYY-MM-DD
  active: Task[]; // owner|assignee · active status · scheduled today OR overdue
  completedToday: Task[]; // owner|assignee · completed within today (agency)
}

/**
 * The current admin's Today workspace: their (owner OR assignee) active tasks that
 * are members of Today (`scheduled_date == today` OR overdue), plus the tasks they
 * completed today (agency day). RLS-scoped; grouping/NBA/progress belong to the
 * pure Today layer, not here. Completed rows are bounded (last 2 days) then filtered
 * to the exact agency day.
 */
export async function getTodayWorkspace(now: Date = new Date()): Promise<TodayWorkspace> {
  const { supabase, adminId } = await authedContext();
  const today = todayDate(now, AGENCY_TZ);
  const mine = `owner_user_id.eq.${adminId},assignee_id.eq.${adminId}`;
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

  const [activeRes, doneRes] = await Promise.all([
    supabase
      .from("tasks")
      .select("*")
      .is("deleted_at", null)
      .in("status", ["planned", "scheduled", "in_progress", "waiting"] as TaskStatus[])
      .or(mine)
      .or(`scheduled_date.eq.${today},due_date.lt.${today}`)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("scheduled_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("tasks")
      .select("*")
      .is("deleted_at", null)
      .eq("status", "completed")
      .or(mine)
      .gte("completed_at", twoDaysAgo)
      .order("completed_at", { ascending: false }),
  ]);
  if (activeRes.error || doneRes.error) throw new TaskError("PersistenceError");

  const active = (activeRes.data ?? []) as Task[];
  const completedToday = ((doneRes.data ?? []) as Task[]).filter(
    (t) => t.completed_at != null && localDate(t.completed_at, AGENCY_TZ) === today
  );
  return { today, active, completedToday };
}

export interface WeekTasks {
  today: string; // agency-local YYYY-MM-DD
  weekStart: string; // Monday (agency-local YYYY-MM-DD)
  weekEnd: string; // Sunday (agency-local YYYY-MM-DD)
  tasks: Task[]; // my active tasks scheduled this week OR overdue
}

/**
 * The current admin's THIS WEEK planning slice: their (owner OR assignee) active
 * tasks whose `scheduled_date` falls in the current agency week (Mon–Sun) OR that
 * are overdue (`due_date < today`). Personal (like My Tasks/Today), RLS-scoped, one
 * query. Inbox/completed/archived/deleted are excluded at the database. Undated
 * tasks that are not overdue are intentionally NOT fetched (This Week has no
 * unscheduled backlog — that lives in My Tasks). Day-bucketing + the overdue split
 * are applied by the pure week-grouping layer, not here.
 */
export async function getWeekTasks(now: Date = new Date()): Promise<WeekTasks> {
  const { supabase, adminId } = await authedContext();
  const today = todayDate(now, AGENCY_TZ);
  const { start: weekStart, end: weekEnd } = weekRange(now, AGENCY_TZ);
  const mine = `owner_user_id.eq.${adminId},assignee_id.eq.${adminId}`;

  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .is("deleted_at", null)
    .in("status", MY_TASKS_STATUSES)
    .or(mine)
    // scheduled within this agency week, OR overdue (due strictly before today)
    .or(`and(scheduled_date.gte.${weekStart},scheduled_date.lte.${weekEnd}),due_date.lt.${today}`)
    .order("scheduled_date", { ascending: true, nullsFirst: false })
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) throw new TaskError("PersistenceError");

  return { today, weekStart, weekEnd, tasks: (data ?? []) as Task[] };
}

/** Active (unresolved) blockers for the given tasks, RLS-scoped. */
export async function getActiveBlockersFor(taskIds: string[]): Promise<TaskBlocker[]> {
  const { supabase } = await authedContext();
  if (taskIds.length === 0) return [];
  const { data, error } = await supabase
    .from("task_blockers")
    .select("*")
    .in("task_id", taskIds)
    .is("resolved_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new TaskError("PersistenceError");
  return (data ?? []) as TaskBlocker[];
}

/** Safe, redaction-applied event history for one task (keyset paginated, ≤200). */
export async function getSafeTaskEvents(
  taskId: string,
  opts: { afterVersion?: number | null; afterSeq?: number | null; limit?: number | null } = {}
): Promise<SafeTaskEvent[]> {
  const { supabase } = await authedContext();
  const { data, error } = await supabase.rpc("read_task_events", {
    p_task_id: taskId,
    p_after_version: opts.afterVersion ?? null,
    p_after_seq: opts.afterSeq ?? null,
    p_limit: opts.limit ?? null,
  });
  if (error) throw new TaskError("PersistenceError");
  return (data ?? []) as SafeTaskEvent[];
}

/** Safe reminder intent for one task (engine fields hidden). */
export async function getSafeTaskReminders(taskId: string): Promise<SafeTaskReminder[]> {
  const { supabase } = await authedContext();
  const { data, error } = await supabase.rpc("read_task_reminders", { p_task_id: taskId });
  if (error) throw new TaskError("PersistenceError");
  return (data ?? []) as SafeTaskReminder[];
}
