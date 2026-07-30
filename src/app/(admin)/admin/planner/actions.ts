"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { PLANNER_ENABLED } from "@/lib/flags";
import { newCorrelationId } from "@/lib/net";
import { reconciliationScheduler } from "@/lib/planner/scheduling/service";
import type { ReconcileSummary } from "@/lib/planner/scheduling/reconcile";

export interface ReconcileNowResult {
  ok?: boolean;
  error?: string;
  summary?: ReconcileSummary;
}

/**
 * Manual "Reconcile now" — invokes the SAME Scheduler abstraction the scheduled
 * trigger uses (refinement 4), so there is exactly one reconciliation execution
 * path. It never calls Google directly.
 */
export async function reconcileNowAction(): Promise<ReconcileNowResult> {
  if (!PLANNER_ENABLED) return { error: "Planner is not enabled." };
  await requireAdmin();
  const summary = await reconciliationScheduler.tick(newCorrelationId());
  revalidatePath("/admin/planner/meetings");
  return { ok: true, summary };
}
