import { NextResponse } from "next/server";
import { isPlannerEnabled, isTasksEnabled } from "@/lib/flags";
import { generateDueRecurrences } from "@/lib/planner/recurrence/generator";

/**
 * Recurrence generator adapter — the internal endpoint a scheduled trigger (the
 * SAME mechanism that already drives /api/planner/reconcile: a Supabase scheduled
 * function / cron) calls to run one occurrence-generation pass. Deliberately its
 * OWN route (not the Google-Calendar reconcile tick): recurrence must run even
 * when Google is not configured, and must not be coupled to calendar sync.
 *
 * Auth is a shared bearer secret (PLANNER_CRON_SECRET), NOT a user session — a
 * scheduled run has no user. Absent secret ⇒ the endpoint is disabled (503), never
 * open. The pass is idempotent (deterministic (definition, slot) keys + the op's
 * permanent unique key), so overlapping ticks are safe.
 *
 * RECOMMENDED CRON INTERVAL: once daily (occurrences are date-based, materialised
 * up to 14 days ahead); more frequent ticks are harmless but unnecessary.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isPlannerEnabled() || !isTasksEnabled()) {
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

  const summary = await generateDueRecurrences();
  return NextResponse.json({ ok: true, summary });
}
