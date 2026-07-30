"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { isPlannerEnabled } from "@/lib/flags";
import { newCorrelationId } from "@/lib/net";
import { reconciliationScheduler, rebuildCalendar } from "@/lib/planner/scheduling/service";
import type { ReconcileSummary } from "@/lib/planner/scheduling/reconcile";
import type { RebuildSummary } from "@/lib/planner/scheduling/rebuild";

export interface ReconcileNowResult {
  ok?: boolean;
  error?: string;
  summary?: ReconcileSummary;
}

export interface RebuildResult {
  ok?: boolean;
  error?: string;
  summary?: RebuildSummary;
}

/**
 * Manual "Reconcile now" — invokes the SAME Scheduler abstraction the scheduled
 * trigger uses (refinement 4), so there is exactly one reconciliation execution
 * path. It never calls Google directly.
 */
export async function reconcileNowAction(): Promise<ReconcileNowResult> {
  if (!isPlannerEnabled()) return { error: "Planner is not enabled." };
  await requireAdmin();
  const summary = await reconciliationScheduler.tick(newCorrelationId());
  revalidatePath("/admin/planner/meetings");
  return { ok: true, summary };
}

/**
 * Rebuild all Portal-managed calendar projections (safe in-place re-sync).
 * Returns the structured audit summary. Portal-managed only; never touches
 * unrelated Google events.
 */
export async function rebuildCalendarAction(): Promise<RebuildResult> {
  if (!isPlannerEnabled()) return { error: "Planner is not enabled." };
  await requireAdmin();
  const summary = await rebuildCalendar();
  revalidatePath("/admin/planner/meetings");
  return { ok: true, summary };
}
