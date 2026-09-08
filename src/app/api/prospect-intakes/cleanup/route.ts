import { NextResponse } from "next/server";
import { authorizeCleanup, runCleanup } from "@/lib/prospect/intake-cleanup";
import { createProspectCleanupStore } from "@/lib/prospect/intake-store";

/**
 * P2-E — stale/expired prospect-draft cleanup endpoint.
 *
 * A scheduled trigger (Vercel Cron or equivalent — NOT pg_cron) POSTs here with
 * `Authorization: Bearer <PROSPECT_CLEANUP_CRON_SECRET>`. There is no user in a
 * scheduled run: auth is a shared bearer secret. Absent secret ⇒ 503 (disabled,
 * fail closed); wrong/missing bearer ⇒ 401; correct ⇒ run.
 *
 * The run hard-deletes ONLY rows matching status='draft' AND token_expires_at <
 * now(), via the service-role store (predicate re-asserted at the delete). It is
 * idempotent and batch-bounded. Errors return a GENERIC message — no Supabase /
 * database internals, row ids, or token hashes are ever exposed.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = authorizeCleanup(
    request.headers.get("authorization"),
    process.env.PROSPECT_CLEANUP_CRON_SECRET
  );
  if (!auth.ok) {
    const error = auth.status === 503 ? "not_configured" : "unauthorized";
    return NextResponse.json({ error }, { status: auth.status });
  }

  try {
    const result = await runCleanup(createProspectCleanupStore(), { now: new Date() });
    return NextResponse.json({ ok: true, ...result });
  } catch {
    // Never leak Supabase/DB internals; a scheduler will retry on the next tick.
    console.error("[intake] cleanup failed");
    return NextResponse.json({ error: "cleanup_failed" }, { status: 500 });
  }
}
