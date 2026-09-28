import { NextResponse } from "next/server";
import { isJarvisEnabled, isJarvisIntelligenceEnabled } from "@/lib/flags";
import { resolveJarvisContextApi } from "@/lib/jarvis/identity";
import { createLLMProvider } from "@/lib/jarvis/llm/factory";
import { runDurableTurn } from "@/lib/jarvis/intelligence/orchestrator";
import { chatRequestSchema, mapOutcomeToResponse } from "@/lib/jarvis/intelligence/transport";

/**
 * Jarvis Intelligence — F1d authenticated chat transport (server-only Route Handler).
 *
 * The SOLE public HTTP boundary for one Jarvis chat turn. It supplies REQUEST DATA to
 * the durable orchestrator; it NEVER supplies AUTHORITY. Trusted workspace/user/grants
 * come only from server-side auth (resolveJarvisContextApi); the transport idempotency
 * key is the one client-provided identity, and it is NOT authority. F1b remains the sole
 * durable claim/replay arbiter — the route never checks-then-runs.
 *
 * Locked order: origin defense → auth (before the disabled 404, so an unauthenticated
 * caller cannot probe enablement) → feature gate → content-type → bounded body → JSON
 * → strict schema → provider (only once enabled+valid) → runDurableTurn → bounded DTO.
 */

export const maxDuration = 60;

const BODY_MAX_BYTES = 131_072; // 128 KiB hard ceiling

function json(status: number, body: unknown): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Deterministic origin/fetch-metadata defense (defense-in-depth atop SameSite=Lax).
 *  Trusted origin = NEXT_PUBLIC_APP_URL's origin. Returns true when the request must be
 *  rejected. Fails CLOSED when an Origin is present but the trusted origin is
 *  unresolvable. Host is never trusted. */
function isBadOrigin(req: Request): boolean {
  const sfs = req.headers.get("sec-fetch-site");
  if (sfs && sfs !== "same-origin" && sfs !== "same-site" && sfs !== "none") return true;
  const origin = req.headers.get("origin");
  if (origin) {
    let trusted: string;
    try {
      trusted = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "").origin;
    } catch {
      return true; // Origin present but trusted origin unresolvable ⇒ fail closed.
    }
    if (!trusted || trusted === "null" || origin !== trusted) return true;
  }
  return false; // Both absent ⇒ proceed to cookie/session auth (not a bypass).
}

/** Read the body with a genuine incremental byte ceiling; never buffers an unbounded
 *  body first. Rejects early on an oversized Content-Length, then enforces the actual
 *  streamed byte count and cancels the reader once the ceiling is crossed. */
async function readBoundedBody(req: Request): Promise<{ ok: true; text: string } | { ok: false }> {
  const cl = req.headers.get("content-length");
  if (cl) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > BODY_MAX_BYTES) return { ok: false };
  }
  const stream = req.body;
  if (!stream) return { ok: true, text: "" };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > BODY_MAX_BYTES) {
        // The size decision is authoritative; cancellation is best-effort. A failing
        // reader.cancel() must NOT turn the intended 413 into a 500.
        try {
          await reader.cancel();
        } catch {
          /* best-effort */
        }
        return { ok: false };
      }
      chunks.push(value);
    }
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(buf) };
}

export async function POST(req: Request): Promise<NextResponse> {
  // 1. Origin / fetch-metadata defense (before anything else).
  if (isBadOrigin(req)) return json(403, { error: "bad_origin" });

  // 2-3. Authenticate FIRST (never redirects) and map denials. Auth precedes the
  //      disabled 404 so an unauthenticated caller cannot probe enablement state.
  const ctx = await resolveJarvisContextApi();
  if ("denied" in ctx) {
    if (ctx.denied === "unauthenticated") return json(401, { error: "unauthenticated" });
    if (ctx.denied === "forbidden_role") return json(403, { error: "forbidden" });
    return json(403, { error: "jarvis_unavailable" }); // no_workspace | not_enabled
  }

  // 4. Feature gate. While disabled: no provider factory, no runDurableTurn, no turn row.
  //    Discloses nothing about which flag/provider/key is off.
  if (!isJarvisEnabled() || !isJarvisIntelligenceEnabled()) {
    return json(404, { error: "not_found" });
  }

  // Outer exception boundary for the ENABLED request-processing path: any genuinely
  // unexpected throw (a body-reader read() rejection, an unexpected runDurableTurn / DB
  // claim exception, etc.) is converted into a bounded, no-store 500 — never a
  // framework 500 that could omit no-store or leak exception/DB/provider/config detail.
  // The deliberate mappings below (415/413/400/503/outcome) return normally and are
  // unaffected. The raw exception is intentionally neither exposed nor logged.
  try {
    // 5. Content-Type — strict essence match (accepts application/json with optional
    //    parameters, any case; rejects +json vendor types, text/json, etc.).
    const essence = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (essence !== "application/json") {
      return json(415, { error: "unsupported_media_type" });
    }

    // 6. Bounded body read (128 KiB), then 7. JSON parse.
    const read = await readBoundedBody(req);
    if (!read.ok) return json(413, { error: "payload_too_large" });
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(read.text);
    } catch {
      return json(400, { error: "invalid_json" });
    }

    // 8. Strict request schema (rejects unknown keys; validates message/threadId/key).
    const parsed = chatRequestSchema.safeParse(parsedJson);
    if (!parsed.success) return json(400, { error: "invalid_request" });

    // 9. Construct the server-selected provider ONLY now (enabled + valid). The caller
    //    cannot choose provider/model. A misconfiguration fails closed as 503 and no
    //    durable turn is claimed (runDurableTurn has not run).
    let provider;
    try {
      provider = createLLMProvider();
    } catch {
      return json(503, { error: "provider_unavailable" });
    }

    // 10. Delegate to the sole durable claim/replay arbiter. Authority is the trusted
    //     server context; the HTTP client disconnecting must NOT abort claimed work, so
    //     req.signal is deliberately NOT propagated into the durable lifecycle.
    const outcome = await runDurableTurn(
      { message: parsed.data.message, threadId: parsed.data.threadId, idempotencyKey: parsed.data.idempotencyKey },
      { provider, resolveContext: async () => ctx }
    );

    // 11-12. Map to the bounded public DTO, no-store.
    const mapped = mapOutcomeToResponse(outcome);
    return json(mapped.status, mapped.body);
  } catch {
    return json(500, { error: "internal_error" });
  }
}
