import "server-only";

import { z } from "zod";
import { MEMORY_CATEGORIES, type MemoryCategory } from "@/lib/jarvis/memory/types";
import type { ValidatedAssistantResponse } from "./types";

/**
 * Jarvis Intelligence — structured response contract (Slice C).
 *
 * MODEL OUTPUT IS UNTRUSTED. This parses/validates/bounds the JSON the provider
 * returns. It NEVER executes anything and NEVER trusts model-claimed provider/
 * model/usage/provenance (those are not in the schema; unknown keys are stripped).
 * At most ONE proposed_intent and ONE memory_candidate (objects, not arrays).
 * Malformed / oversized / missing-assistant_message ⇒ a safe validation failure.
 */

// Reject absurdly large payloads before JSON.parse (defense against huge blobs).
const MAX_RAW_TEXT = 60_000;

const uncertaintySchema = z
  .object({
    level: z.enum(["low", "medium", "high"]),
    notes: z.string().max(1000).optional(),
  })
  .strict();

const proposedIntentSchema = z
  .object({
    capability_id: z.string().min(1).max(120),
    // `args` is intentionally OPEN: capability arguments are capability-specific
    // opaque data at this stage. The ENVELOPE around it is strict, so a model
    // cannot smuggle sibling fields like `approved` / `executed` into the intent.
    args: z.record(z.string(), z.unknown()),
    rationale: z.string().max(1000).optional(),
  })
  .strict();

const memoryCandidateSchema = z
  .object({
    scope: z.enum(["agency", "client", "user"]),
    category: z.enum(MEMORY_CATEGORIES as unknown as [string, ...string[]]),
    claim: z.string().min(1).max(2000),
    body: z.string().max(8000).optional(),
  })
  .strict();

// STRICT validation at every operational object boundary: an unexpected key is a
// VALIDATION FAILURE, never silently stripped. Model output is untrusted external
// data, so a model that emits provider/model/usage/provenance/workspace_id/execute
// (root) or approved/client_id (nested) fails validation and enters the SAFE
// FAILURE path — we do not normalize away unexpected fields. (`proposed_intent.args`
// is the one deliberate exception; see above.)
const responseSchema = z
  .object({
    assistant_message: z.string().min(1).max(8000),
    reasoning_summary: z.string().max(4000).optional(),
    uncertainty: uncertaintySchema.optional(),
    proposed_intent: proposedIntentSchema.optional(),
    memory_candidate: memoryCandidateSchema.optional(),
  })
  .strict();

export type ParseResult =
  | { ok: true; value: ValidatedAssistantResponse }
  | { ok: false; reason: "too_large" | "not_json" | "schema" };

/**
 * Extract the FIRST complete, brace-balanced top-level JSON object from raw model
 * text, or null. This tolerates ONLY benign presentation envelopes a live model may
 * add around the required object — a ```json / ``` markdown code fence, or a leading/
 * trailing sentence — since the scan simply locates the first `{` and its matching
 * `}`, ignoring anything outside. It is STRING-AWARE (a `}` inside a JSON string value
 * never closes the object) and FAILS CLOSED: an unbalanced/truncated object returns
 * null (never a partially-recovered fragment). It changes only WHERE the object is
 * found — the strict schema below is unchanged, so unknown keys / wrong shapes / bounds
 * are still rejected exactly as before, and nothing is executed or trusted here.
 */
export function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null; // unbalanced / truncated ⇒ fail closed, no partial recovery
}

export function parseAssistantResponse(rawText: string): ParseResult {
  if (typeof rawText !== "string" || rawText.length === 0 || rawText.length > MAX_RAW_TEXT) {
    return { ok: false, reason: "too_large" };
  }
  // Accept the required object even when the model wraps it in a code fence or adds a
  // leading/trailing sentence; reject anything without a complete balanced object.
  const candidate = extractJsonObject(rawText);
  if (candidate === null) return { ok: false, reason: "not_json" };
  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "schema" };

  const d = parsed.data;
  return {
    ok: true,
    value: {
      assistantMessage: d.assistant_message,
      reasoningSummary: d.reasoning_summary,
      uncertainty: d.uncertainty,
      proposedIntent: d.proposed_intent
        ? { capabilityId: d.proposed_intent.capability_id, args: d.proposed_intent.args, rationale: d.proposed_intent.rationale }
        : undefined,
      memoryCandidate: d.memory_candidate
        ? { scope: d.memory_candidate.scope, category: d.memory_candidate.category as MemoryCategory, claim: d.memory_candidate.claim, body: d.memory_candidate.body }
        : undefined,
    },
  };
}
