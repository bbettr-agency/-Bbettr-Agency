import { processItn } from "@/lib/payfast/itn";
import { isPayfastItnEnabled } from "@/lib/payfast/config";

// Needs Node crypto + outbound fetch (validate postback), and must never be
// statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PayFast ITN endpoint (the notify_url baked into every payment link). PayFast
 * POSTs application/x-www-form-urlencoded here when a payment changes state.
 *
 * Always responds 200 on receipt so PayFast stops retrying — even when the
 * notification is rejected. Rejections mutate nothing; the reason is logged to
 * the record's itn_error for audit. Secrets are never logged or returned.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  // Kill-switch: acknowledge without mutating, leaving manual "Mark as paid".
  if (!isPayfastItnEnabled()) {
    console.info("[payfast-itn] disabled via PAYFAST_ITN_ENABLED — acknowledged, no-op");
    return new Response("ITN disabled", { status: 200 });
  }

  try {
    const result = await processItn(rawBody);
    if (result.ok) {
      console.info("[payfast-itn] processed", { reason: result.reason ?? "ok" });
    } else {
      console.warn("[payfast-itn] rejected", { reason: result.reason });
    }
  } catch (err) {
    // Never let an error turn into a non-200 (would trigger endless retries).
    console.error("[payfast-itn] error", err instanceof Error ? err.message : err);
  }

  return new Response("OK", { status: 200 });
}
