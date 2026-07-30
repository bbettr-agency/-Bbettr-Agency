import { NextResponse } from "next/server";
import { PLANNER_ENABLED } from "@/lib/flags";
import { newCorrelationId } from "@/lib/net";
import { reconciliationScheduler } from "@/lib/planner/scheduling/service";

/**
 * Scheduler adapter: the internal endpoint a scheduled trigger (today a Supabase
 * scheduled function / cron) calls to run one due-reconciliation pass. It drives
 * the SAME Scheduler abstraction as the manual "Reconcile now" — one execution
 * path. Swapping to a different scheduler changes only who calls this route.
 *
 * Auth is a shared bearer secret (PLANNER_CRON_SECRET), NOT a user session —
 * there is no user in a scheduled run. Absent secret ⇒ the endpoint is disabled
 * (503), never open.
 *
 * A pass is time-budgeted (PLANNER_RECONCILE_MAX_MS, default 8s) and stops before
 * the function timeout, leaving the rest pending for the next tick. Keep the
 * budget below `maxDuration` below.
 *
 * RECOMMENDED CRON INTERVAL: every 2–5 minutes (and ≥ 2× the max pass duration),
 * so backlogs drain steadily without overlapping ticks. Overlap is safe anyway —
 * per-row locking prevents double processing.
 */

// Give the pass headroom on platforms that honour it (e.g. Vercel; capped by plan).
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!PLANNER_ENABLED) {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }

  const secret = process.env.PLANNER_CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const summary = await reconciliationScheduler.tick(newCorrelationId());
  return NextResponse.json({ ok: true, summary });
}
