"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { isPlannerEnabled } from "@/lib/flags";
import { newCorrelationId } from "@/lib/net";
import {
  reconciliationScheduler,
  rebuildCalendar,
  reconcileMeetingManually,
} from "@/lib/planner/scheduling/service";
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

export interface RetrySyncResult {
  ok?: boolean;
  error?: string;
  /** Honest per-meeting outcome for the UI. */
  state?: "synced" | "meet_pending" | "failed" | "disconnected" | "skipped";
}

/**
 * Per-meeting "Retry sync" — reconciles ONE existing meeting through the shared
 * engine (deterministic event id → same event, no duplicate Portal meeting /
 * Google event / Meet). Honest result: reports synced / meet-pending / failed /
 * disconnected / skipped(not configured). Never bypasses the Google-config gate.
 */
export async function retryMeetingSyncAction(meetingId: string): Promise<RetrySyncResult> {
  if (!isPlannerEnabled()) return { error: "Planner is not enabled." };
  await requireAdmin();
  if (!meetingId) return { error: "Missing meeting id." };

  const res = await reconcileMeetingManually(meetingId);
  revalidatePath("/admin/planner/meetings");
  revalidatePath(`/admin/planner/meetings/${meetingId}`);

  if (res.result === "success") {
    return { ok: true, state: res.meetPending ? "meet_pending" : "synced" };
  }
  if (res.result === "failure") {
    return { ok: true, state: res.disconnected ? "disconnected" : "failed" };
  }
  // skipped (not configured / locked / no change) — treat "not_configured" as a
  // clear skipped signal; other skips mean nothing to do right now.
  return { ok: true, state: "skipped" };
}
