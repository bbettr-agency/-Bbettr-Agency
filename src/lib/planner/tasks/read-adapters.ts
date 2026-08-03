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
import { AGENCY_TZ, todayDate } from "@/lib/planner/meetings/date-views";
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
