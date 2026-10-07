import "server-only";

import { isJarvisEnabled, isJarvisIntelligenceEnabled, isJarvisRetrievalV2Enabled, isJarvisAgenticReadEnabled } from "@/lib/flags";

/**
 * ⚠️ TEMPORARY DIAGNOSTIC — REMOVE AFTER MILESTONE-A FLAG ISSUE IS RESOLVED.
 *
 * Captures ONLY safe, derived flag/runtime metadata for a single Jarvis turn so we can
 * observe — via the existing provenance + safe SQL read — what the live Production
 * function actually resolves for JARVIS_AGENTIC_READ.
 *
 * SECURITY: this NEVER returns a raw environment value, VERCEL_ENV string, secret, token,
 * or credential. The only fields are booleans and ONE integer (a string length). The raw
 * value of JARVIS_AGENTIC_READ is reduced to `.length` and two booleans; VERCEL_ENV is
 * reduced to a single boolean. By construction nothing stringifiable here can carry an
 * env value.
 */
export interface FlagDiagnostics {
  jarvisEnabled: boolean;
  intelligenceEnabled: boolean;
  retrievalV2Enabled: boolean;
  agenticReadEnabled: boolean;
  /** Whether JARVIS_AGENTIC_READ is defined at all in this runtime. */
  agenticReadPresent: boolean;
  /** Length of the raw value (NOT the value) — distinguishes "true"(4) / "false"(5) / "true\n"(5) / absent(0). */
  agenticReadLen: number;
  /** Whether the TRIMMED raw value equals "true" (detects hidden whitespace/newline). */
  agenticReadTrimmedTrue: boolean;
  /** Derived boolean only — never the raw VERCEL_ENV string. */
  servingProduction: boolean;
}

export function collectFlagDiagnostics(): FlagDiagnostics {
  const rawAgentic = process.env.JARVIS_AGENTIC_READ;
  const s = rawAgentic ?? "";
  return {
    jarvisEnabled: isJarvisEnabled(),
    intelligenceEnabled: isJarvisIntelligenceEnabled(),
    retrievalV2Enabled: isJarvisRetrievalV2Enabled(),
    agenticReadEnabled: isJarvisAgenticReadEnabled(),
    agenticReadPresent: rawAgentic !== undefined,
    agenticReadLen: s.length,
    agenticReadTrimmedTrue: s.trim() === "true",
    servingProduction: process.env.VERCEL_ENV === "production",
  };
}
