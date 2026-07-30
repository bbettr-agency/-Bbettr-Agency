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
 */
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
