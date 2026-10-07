import { describe, it, expect, afterEach } from "vitest";
import { collectFlagDiagnostics } from "./flag-diagnostics";

/**
 * ⚠️ TEMPORARY DIAGNOSTIC TESTS — remove with flag-diagnostics.ts.
 * The security-critical assertion: the diagnostic object can carry ONLY booleans and a
 * single length integer — a raw env value can never leak into it.
 */

const KEYS = ["JARVIS_ENABLED", "JARVIS_INTELLIGENCE_ENABLED", "JARVIS_RETRIEVAL_V2", "JARVIS_AGENTIC_READ", "VERCEL_ENV"] as const;
const saved: Record<string, string | undefined> = {};
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
function setEnv(env: Partial<Record<(typeof KEYS)[number], string | undefined>>) {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("collectFlagDiagnostics — safe shape", () => {
  it("returns EXACTLY the 8 expected keys, all boolean or number (never a string)", () => {
    setEnv({ JARVIS_AGENTIC_READ: "true", VERCEL_ENV: "production" });
    const d = collectFlagDiagnostics();
    expect(Object.keys(d).sort()).toEqual(
      [
        "agenticReadEnabled",
        "agenticReadLen",
        "agenticReadPresent",
        "agenticReadTrimmedTrue",
        "intelligenceEnabled",
        "jarvisEnabled",
        "retrievalV2Enabled",
        "servingProduction",
      ].sort()
    );
    for (const [k, v] of Object.entries(d)) {
      const t = typeof v;
      expect(t === "boolean" || (k === "agenticReadLen" && t === "number")).toBe(true);
    }
  });

  it("NEVER includes the raw JARVIS_AGENTIC_READ value — only its length + booleans", () => {
    const sentinel = "SENTINEL_RAW_VALUE_ZZZ";
    setEnv({ JARVIS_AGENTIC_READ: sentinel, VERCEL_ENV: "production" });
    const d = collectFlagDiagnostics();
    expect(JSON.stringify(d)).not.toContain(sentinel);
    expect(d.agenticReadPresent).toBe(true);
    expect(d.agenticReadLen).toBe(sentinel.length); // length only
    expect(d.agenticReadTrimmedTrue).toBe(false);
    expect(d.agenticReadEnabled).toBe(false);
  });

  it("NEVER includes the raw VERCEL_ENV string — only a derived boolean", () => {
    setEnv({ VERCEL_ENV: "preview-SENTINEL-ENV", JARVIS_AGENTIC_READ: "true" });
    const d = collectFlagDiagnostics();
    expect(JSON.stringify(d)).not.toContain("preview-SENTINEL-ENV");
    expect(d.servingProduction).toBe(false);
  });
});

describe("collectFlagDiagnostics — derivation (reproduces the suspected Production conditions)", () => {
  it("clean 'true' ⇒ enabled, len 4, trimmedTrue true", () => {
    setEnv({ JARVIS_AGENTIC_READ: "true" });
    const d = collectFlagDiagnostics();
    expect(d.agenticReadEnabled).toBe(true);
    expect(d.agenticReadLen).toBe(4);
    expect(d.agenticReadTrimmedTrue).toBe(true);
  });

  it("the Preview value 'false' ⇒ disabled, len 5, trimmedTrue false", () => {
    setEnv({ JARVIS_AGENTIC_READ: "false" });
    const d = collectFlagDiagnostics();
    expect(d.agenticReadEnabled).toBe(false);
    expect(d.agenticReadPresent).toBe(true);
    expect(d.agenticReadLen).toBe(5);
    expect(d.agenticReadTrimmedTrue).toBe(false);
  });

  it("hidden whitespace 'true\\n' ⇒ enabled false but trimmedTrue TRUE (the smoking gun)", () => {
    setEnv({ JARVIS_AGENTIC_READ: "true\n" });
    const d = collectFlagDiagnostics();
    expect(d.agenticReadEnabled).toBe(false); // === "true" fails
    expect(d.agenticReadLen).toBe(5);
    expect(d.agenticReadTrimmedTrue).toBe(true); // reveals the whitespace
  });

  it("absent ⇒ present false, len 0, enabled false", () => {
    setEnv({ JARVIS_AGENTIC_READ: undefined });
    const d = collectFlagDiagnostics();
    expect(d.agenticReadPresent).toBe(false);
    expect(d.agenticReadLen).toBe(0);
    expect(d.agenticReadEnabled).toBe(false);
  });
});
