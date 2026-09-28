import type { PublicActionOutcome, PublicMemoryOutcome, PublicUncertainty } from "@/lib/jarvis/intelligence/transport";

/**
 * Jarvis chat — PURE per-turn logic (F3, no React, fully testable). All the
 * correctness-critical transport behaviour lives here: fresh-key-per-submission,
 * exact retry replay (same key + same original threadIdSent, never inject a returned
 * threadId), session-thread adoption, and the trusted-DTO → view mapping + error copy.
 * The UI component owns only React state and rendering.
 */

/** MUST match the transport / orchestrator cap (MESSAGE_MAX_CHARS in transport.ts). */
export const MESSAGE_MAX_CHARS = 20_000;

/** An immutable snapshot of one logical submission. A manual retry re-sends THIS object
 *  verbatim — same key, same message, same threadIdSent — so a retry can never become a
 *  new logical turn or (for a first-turn retry) inject a thread id the original omitted. */
export interface Submission {
  readonly message: string;
  readonly idempotencyKey: string;
  /** The threadId the ORIGINAL submission sent (undefined = omitted). Frozen for retries. */
  readonly threadIdSent: string | undefined;
}

/** Build a NEW submission: trim, snapshot the current session thread, mint a fresh key.
 *  `uuid` is injectable for deterministic tests; production passes crypto.randomUUID. */
export function newSubmission(
  rawMessage: string,
  currentThreadId: string | undefined,
  uuid: () => string = () => crypto.randomUUID()
): Submission {
  return { message: rawMessage.trim(), idempotencyKey: uuid(), threadIdSent: currentThreadId };
}

/** The exact JSON body posted to /api/jarvis/chat. threadId is OMITTED when the
 *  submission's threadIdSent is undefined — this preserves F1b request-hash identity on
 *  first-turn retries (injecting a returned threadId would flip the hash → 409). */
export function toRequestBody(sub: Submission): { message: string; idempotencyKey: string; threadId?: string } {
  return sub.threadIdSent !== undefined
    ? { message: sub.message, idempotencyKey: sub.idempotencyKey, threadId: sub.threadIdSent }
    : { message: sub.message, idempotencyKey: sub.idempotencyKey };
}

/** Adopt the returned threadId as the session thread ONLY if none is set yet (first
 *  completed turn). Continuation turns keep the existing session thread. Pure. */
export function adoptThreadId(current: string | undefined, completedThreadId: string): string {
  return current ?? completedThreadId;
}

// ── Trusted-DTO → view mapping ───────────────────────────────────────────────
export type TurnResponse =
  | {
      kind: "completed";
      assistantMessage: string;
      threadId: string;
      requestId: string;
      replay: boolean;
      clarification: boolean;
      uncertainty?: PublicUncertainty;
      action?: PublicActionOutcome;
      memory?: PublicMemoryOutcome;
    }
  | { kind: "processing" }
  | { kind: "error"; code: string; message: string; retryable: boolean; retryAfterSeconds?: number };

/** Friendly, honest public copy per error code. Never surfaces raw provider/DB detail. */
export function errorCopy(code: string): { message: string; retryable: boolean } {
  switch (code) {
    case "not_found":
      return { message: "Jarvis chat isn't available right now.", retryable: false };
    case "unauthenticated":
      return { message: "Your session has expired — please sign in again.", retryable: false };
    case "forbidden":
    case "jarvis_unavailable":
      return { message: "You don't have access to Jarvis chat.", retryable: false };
    case "idempotency_conflict":
      return { message: "That didn't match the original message. Start a new chat to continue.", retryable: false };
    case "invalid_request":
    case "payload_too_large":
      return { message: "That message couldn't be sent.", retryable: false };
    case "rate_limited":
      return { message: "You're sending messages too quickly. Please wait a moment.", retryable: true };
    case "provider_timeout":
      return { message: "That took too long — please try again.", retryable: true };
    case "provider_error":
    case "provider_invalid_response":
      return { message: "Jarvis had trouble responding — please try again.", retryable: true };
    case "unavailable":
    case "provider_unavailable":
    case "context_unavailable":
      return { message: "Jarvis is temporarily unavailable — please try again.", retryable: true };
    case "internal_error":
      return { message: "Something went wrong on our side — please try again.", retryable: true };
    case "network":
      return { message: "Couldn't reach Jarvis. Check your connection and try again.", retryable: true };
    default:
      return { message: "Something went wrong — please try again.", retryable: true };
  }
}

/**
 * Map a raw HTTP result (status + parsed JSON body + optional Retry-After header) to a
 * TurnResponse. A failed turn is ALWAYS an error — never a fabricated assistant message.
 * A completed (200) turn — whether replay:true or false — renders the same content.
 */
export function mapResponse(status: number, body: unknown, retryAfterHeader?: string | null): TurnResponse {
  const b = (body ?? {}) as Record<string, unknown>;
  if (status === 200 && b.status === "completed" && typeof b.assistantMessage === "string") {
    return {
      kind: "completed",
      assistantMessage: b.assistantMessage,
      threadId: typeof b.threadId === "string" ? b.threadId : "",
      requestId: typeof b.requestId === "string" ? b.requestId : "",
      replay: b.replay === true,
      clarification: b.clarification === true,
      uncertainty: isUncertainty(b.uncertainty) ? b.uncertainty : undefined,
      action: isActon(b.action) ? b.action : undefined,
      memory: isMemory(b.memory) ? b.memory : undefined,
    };
  }
  if (status === 202 && b.status === "processing") return { kind: "processing" };

  const code = typeof b.error === "string" ? b.error : `http_${status}`;
  const copy = errorCopy(code);
  const retryAfterSeconds = code === "rate_limited" ? parseRetryAfter(retryAfterHeader) : undefined;
  return { kind: "error", code, message: copy.message, retryable: copy.retryable, retryAfterSeconds };
}

function parseRetryAfter(h: string | null | undefined): number | undefined {
  if (!h) return undefined;
  const n = Number(h);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : undefined;
}

function isUncertainty(v: unknown): v is PublicUncertainty {
  return !!v && typeof (v as { level?: unknown }).level === "string";
}
function isActon(v: unknown): v is PublicActionOutcome {
  return !!v && typeof (v as { status?: unknown }).status === "string";
}
function isMemory(v: unknown): v is PublicMemoryOutcome {
  return !!v && typeof (v as { status?: unknown }).status === "string";
}
