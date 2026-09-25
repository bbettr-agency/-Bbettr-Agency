import "server-only";

/**
 * Jarvis Intelligence — central limits/config (Slice B). One typed source of
 * truth; no magic numbers scattered elsewhere.
 *
 * Env override policy (documented, safest convention):
 *   • env overrides are parsed with strict bounds;
 *   • malformed / non-numeric / zero / negative ⇒ silently fall back to the
 *     DEFAULT (fail-safe, never absurd);
 *   • an in-range-but-extreme value is CLAMPED to a hard [min,max] cap, so an env
 *     mistake can never request an absurd token/time budget.
 * The per-turn call/retry policy is FIXED (not env-overridable) — it is policy,
 * not tuning.
 */
export interface IntelligenceLimits {
  historyTurns: number;
  maxOutputTokens: number;
  timeoutMs: number;
  /** Fixed policy: exactly one provider call per normal turn. */
  readonly maxProviderCallsPerTurn: 1;
  /** Fixed policy: at most one transient retry (owned by the orchestrator later). */
  readonly maxTransientRetries: 1;
}

const DEFAULTS = { historyTurns: 10, maxOutputTokens: 1200, timeoutMs: 30_000 } as const;

/** Hard bounds — env overrides are clamped into these; defaults sit inside them. */
const BOUNDS = {
  historyTurns: { min: 1, max: 50 },
  maxOutputTokens: { min: 1, max: 4_000 },
  timeoutMs: { min: 1_000, max: 120_000 },
} as const;

/**
 * Resolve an integer env override: invalid/≤0 ⇒ default; otherwise clamp to
 * [min,max]. Pure given `raw`.
 */
export function boundedInt(raw: string | undefined, def: number, min: number, max: number): number {
  if (raw === undefined || raw === null || raw.trim() === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return def;
  return Math.min(Math.max(n, min), max);
}

/** The active limits, honoring bounded env overrides. Read at call time. */
export function getIntelligenceLimits(): IntelligenceLimits {
  return {
    historyTurns: boundedInt(process.env.JARVIS_LLM_HISTORY_TURNS, DEFAULTS.historyTurns, BOUNDS.historyTurns.min, BOUNDS.historyTurns.max),
    maxOutputTokens: boundedInt(process.env.JARVIS_LLM_MAX_OUTPUT_TOKENS, DEFAULTS.maxOutputTokens, BOUNDS.maxOutputTokens.min, BOUNDS.maxOutputTokens.max),
    timeoutMs: boundedInt(process.env.JARVIS_LLM_TIMEOUT_MS, DEFAULTS.timeoutMs, BOUNDS.timeoutMs.min, BOUNDS.timeoutMs.max),
    maxProviderCallsPerTurn: 1,
    maxTransientRetries: 1,
  };
}

export const INTELLIGENCE_LIMIT_DEFAULTS = DEFAULTS;
export const INTELLIGENCE_LIMIT_BOUNDS = BOUNDS;
