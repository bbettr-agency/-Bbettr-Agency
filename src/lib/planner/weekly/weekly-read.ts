import "server-only";

/**
 * Weekly Updates server read model. Authenticated + RLS-scoped — NO service-role.
 * Merges two sources for the selected agency week into presentation-safe
 * `WeeklyUpdateItem`s: completed Planner tasks (attributed by completed_by) and
 * manual weekly_updates (attributed to author). A raw Task/DB row never leaves
 * this module. One server `now` drives the heading, week bounds, and both queries
 * so they cannot disagree around midnight.
 *
 * Query budget (all workspace-bounded, no N+1): one completed-tasks read, one
 * manual-updates read, one admin-team read, one fallback-names read (only for
 * members not on the team), one batched client-name read.
 */
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isTasksEnabled } from "@/lib/flags";
import { AGENCY_TZ, formatDayLabel, localDate, weekRange } from "@/lib/planner/meetings/date-views";
import { listAdminTeam } from "@/lib/planner/team";
import { TaskError } from "@/lib/planner/tasks/errors";
import type { WeeklyUpdateItem } from "./weekly-board";

const UNKNOWN_CLIENT_LABEL = "Unknown client";

export interface WeeklyUpdatesData {
  weekStart: string; // Monday (agency-local YYYY-MM-DD)
  weekEnd: string; // Sunday
  prevWeek: string; // Monday of the previous week (for ?week nav)
  nextWeek: string; // Monday of the next week
  isCurrentWeek: boolean;
  weekLabel: string; // e.g. "10 – 16 Aug"
  today: string; // agency-local YYYY-MM-DD (server-computed default for the add form)
  items: WeeklyUpdateItem[];
  members: { id: string; name: string }[]; // for the member filter
  pickerClients: { id: string; name: string }[]; // for the manual-update client picker
  currentAdminId: string;
}

type CompletedRow = { id: string; title: string; completed_at: string | null; completed_by: string | null; client_id: string | null };
type ManualRow = { id: string; author_user_id: string; summary: string; client_id: string | null; update_date: string };

/** Plain-date shift in UTC (YYYY-MM-DD ± days) — pure, no timezone drift. */
function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function dayIso(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString();
}
const shortDay = (ymd: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${ymd}T12:00:00Z`));

export async function getWeeklyUpdates(weekParam?: string, now: Date = new Date()): Promise<WeeklyUpdatesData> {
  if (!isTasksEnabled()) throw new TaskError("TasksDisabled");
  const profile = await getCurrentProfile();
  if (!profile) throw new TaskError("NotAuthenticated");
  if (profile.role !== "admin") throw new TaskError("NotAuthorized");
  const supabase = await createClient();

  // Resolve the target week (Mon–Sun). A ?week=YYYY-MM-DD selects that week; else
  // the current agency week. Anchored at UTC-noon so the agency date is stable.
  // A ?week must be well-formatted AND a real date; e.g. "2026-13-45" passes the
  // regex but is Invalid Date — fall back to the current week instead of throwing.
  const parsed = weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? new Date(`${weekParam}T12:00:00Z`) : null;
  const ref = parsed && !Number.isNaN(parsed.getTime()) ? parsed : now;
  const { start: weekStart, end: weekEnd } = weekRange(ref, AGENCY_TZ);
  const currentWeekStart = weekRange(now, AGENCY_TZ).start;

  const [doneRes, manualRes, team, clientsRes] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, completed_at, completed_by, client_id")
      .is("deleted_at", null)
      .eq("status", "completed")
      .gte("completed_at", dayIso(weekStart, -1))
      .lt("completed_at", dayIso(weekEnd, 2)),
    supabase
      .from("weekly_updates")
      .select("id, author_user_id, summary, client_id, update_date")
      .gte("update_date", weekStart)
      .lte("update_date", weekEnd),
    listAdminTeam(profile.workspace_id),
    supabase.from("clients").select("id, name").order("name", { ascending: true }),
  ]);
  if (doneRes.error || manualRes.error) throw new TaskError("PersistenceError");

  const completed = ((doneRes.data ?? []) as CompletedRow[]).filter(
    (r) => r.completed_at != null && localDate(r.completed_at, AGENCY_TZ) >= weekStart && localDate(r.completed_at, AGENCY_TZ) <= weekEnd
  );
  const manual = (manualRes.data ?? []) as ManualRow[];

  // ── Member names: team first, then a single fallback read for any member not on
  // the team (e.g. a former admin) so a name never blanks. ─────────────────────
  const nameById = new Map(team.map((m) => [m.id, m.fullName]));
  const missingMemberIds = [
    ...new Set(
      [...completed.map((r) => r.completed_by), ...manual.map((r) => r.author_user_id)].filter(
        (id): id is string => id != null && !nameById.has(id)
      )
    ),
  ];
  if (missingMemberIds.length > 0) {
    const { data } = await supabase.from("profiles").select("id, full_name").in("id", missingMemberIds);
    for (const p of data ?? []) nameById.set(p.id, p.full_name ?? "Unknown");
  }
  const memberName = (id: string | null) => (id != null ? nameById.get(id) ?? "Unknown" : "Unknown");

  // ── Client names (one read of the workspace clients; also feeds the picker). ─
  const pickerClients = (clientsRes.data ?? []).map((c) => ({ id: c.id, name: c.name }));
  const clientNameById = new Map(pickerClients.map((c) => [c.id, c.name]));
  const clientName = (id: string | null): string | null => (id == null ? null : clientNameById.get(id) ?? UNKNOWN_CLIENT_LABEL);

  const items: WeeklyUpdateItem[] = [];
  for (const r of completed) {
    if (r.completed_by == null || r.completed_at == null) continue;
    items.push({
      id: r.id,
      source: "task",
      text: r.title,
      memberId: r.completed_by,
      memberName: memberName(r.completed_by),
      clientId: r.client_id,
      clientName: clientName(r.client_id),
      dateLabel: formatDayLabel(localDate(r.completed_at, AGENCY_TZ), now, AGENCY_TZ),
      sortAt: r.completed_at,
      canDelete: false, // completed tasks are read-only here
    });
  }
  for (const r of manual) {
    items.push({
      id: r.id,
      source: "manual",
      text: r.summary,
      memberId: r.author_user_id,
      memberName: memberName(r.author_user_id),
      clientId: r.client_id,
      clientName: clientName(r.client_id),
      dateLabel: formatDayLabel(r.update_date, now, AGENCY_TZ),
      sortAt: `${r.update_date}T00:00:00Z`,
      canDelete: r.author_user_id === profile.id, // author-only delete
    });
  }

  return {
    weekStart,
    weekEnd,
    prevWeek: shiftYmd(weekStart, -7),
    nextWeek: shiftYmd(weekStart, 7),
    isCurrentWeek: weekStart === currentWeekStart,
    weekLabel: `${shortDay(weekStart)} – ${shortDay(weekEnd)}`,
    today: localDate(now.toISOString(), AGENCY_TZ),
    items,
    members: team.map((m) => ({ id: m.id, name: m.fullName })),
    pickerClients,
    currentAdminId: profile.id,
  };
}
