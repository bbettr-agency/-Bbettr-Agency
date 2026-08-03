import "server-only";

/**
 * Task-view access gate. Composes the existing Planner guard (admin + Planner
 * module) with the request-time TASKS_ENABLED flag, so a future task page can
 * choose between the real Tasks surface and the existing PlannerPlaceholder
 * WITHOUT duplicating auth logic.
 *
 * `requirePlannerAccess()` already redirects non-admins (clients/reps never
 * reach a Planner route) and 404s when the Planner module is off — so this adds
 * no new redirect behaviour; it only surfaces whether the Tasks surface should
 * render. When `tasksEnabled` is false the caller renders the placeholder.
 */
import { requirePlannerAccess } from "@/lib/planner/guard";
import { isTasksEnabled } from "@/lib/flags";
import type { Profile } from "@/lib/database.types";

export interface TasksViewAccess {
  /** The authenticated admin profile (Planner access already enforced). */
  profile: Profile;
  /** Whether the real Tasks UI may render (false ⇒ show PlannerPlaceholder). */
  tasksEnabled: boolean;
}

export async function requireTasksView(): Promise<TasksViewAccess> {
  const profile = await requirePlannerAccess();
  return { profile, tasksEnabled: isTasksEnabled() };
}
