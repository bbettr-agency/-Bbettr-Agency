/**
 * Jarvis Capability Registry (Foundation 1). Pure metadata + input validation.
 *
 * This is the ONLY set of operations Jarvis (or, later, the LLM proposing on a
 * human's behalf) can request. There is deliberately NO execute_sql, no generic
 * API caller, no raw service-role tool, and no way to create capabilities at
 * runtime. Handlers (the side-effecting boundary) live in `handlers.ts`
 * (server-only) and are looked up by id; this file stays pure so the policy
 * engine and tests need no server imports.
 *
 * Foundation 1 ships the MINIMUM capabilities needed to exercise every path
 * (auto / confirm / monitor) and the task-write integration — not broad powers.
 */
import type { RiskClass, CapabilityScope } from "./types";

export interface ParseOk<A> {
  ok: true;
  args: A;
}
export interface ParseErr {
  ok: false;
  error: string;
}
export type ParseResult<A> = ParseOk<A> | ParseErr;

export interface JarvisCapability<A = unknown> {
  id: string;
  title: string;
  description: string;
  riskClass: RiskClass;
  /** Grant key the principal must hold (see bundles.ts). */
  requiredGrant: string;
  scope: CapabilityScope;
  /** A disabled capability is registered but refused (deny) by policy. */
  enabled: boolean;
  /** Validate + narrow untrusted input. NEVER trusts model/content-supplied ids. */
  parse(input: unknown): ParseResult<A>;
}

// ── input helpers (no external deps) ─────────────────────────────────────────
function obj(input: unknown): Record<string, unknown> | null {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Foundation 1 capabilities ────────────────────────────────────────────────

/** Trivial no-op — proves the allow + audit path end to end. */
const ping: JarvisCapability<Record<string, never>> = {
  id: "jarvis.ping",
  title: "Ping",
  description: "Health/authorization probe. Returns ok. No side effects.",
  riskClass: "auto",
  requiredGrant: "jarvis.use",
  scope: "agency",
  enabled: true,
  parse: () => ({ ok: true, args: {} }),
};

/** Read-only agency metric — proves the auto read path over existing data. */
const readTaskCounts: JarvisCapability<Record<string, never>> = {
  id: "portal.read_task_counts",
  title: "Read task counts",
  description: "Counts Planner tasks by status in the agency workspace (read-only).",
  riskClass: "auto",
  requiredGrant: "portal.read",
  scope: "agency",
  enabled: true,
  parse: () => ({ ok: true, args: {} }),
};

/** Confirm-required internal write — routes through the LEGAL task command. */
export interface ProposeInternalTaskArgs {
  title: string;
}
const proposeInternalTask: JarvisCapability<ProposeInternalTaskArgs> = {
  id: "portal.propose_internal_task",
  title: "Create internal task",
  description:
    "Proposes creating an internal Planner task (CaptureTask). Requires human approval; on approval it executes via the existing apply_task_command boundary.",
  riskClass: "confirm",
  requiredGrant: "portal.tasks.write",
  scope: "agency",
  enabled: true,
  parse(input) {
    const o = obj(input);
    const title = o ? str(o.title)?.trim() : null;
    if (!title) return { ok: false, error: "title is required" };
    if (title.length > 200) return { ok: false, error: "title too long" };
    return { ok: true, args: { title } };
  },
};

/** Monitor-only external read — Foundation 1 has NO adapter, returns unknown. */
export interface ReadDeploymentStateArgs {
  clientId?: string;
}
const readDeploymentState: JarvisCapability<ReadDeploymentStateArgs> = {
  id: "integrations.read_deployment_state",
  title: "Read deployment state",
  description:
    "Monitor-only. Would read production deployment state; no adapter exists in Foundation 1, so it reports 'unknown/unavailable' — never a fabricated result.",
  riskClass: "monitor",
  requiredGrant: "integrations.read",
  scope: "agency",
  enabled: true,
  parse(input) {
    const o = obj(input);
    const clientId = o ? str(o.clientId) : null;
    if (clientId && !UUID_RE.test(clientId)) return { ok: false, error: "clientId must be a uuid" };
    return { ok: true, args: clientId ? { clientId } : {} };
  },
};

export const CAPABILITY_REGISTRY: Readonly<Record<string, JarvisCapability>> = Object.freeze({
  [ping.id]: ping,
  [readTaskCounts.id]: readTaskCounts,
  [proposeInternalTask.id]: proposeInternalTask,
  [readDeploymentState.id]: readDeploymentState,
});

/** Look up a registered capability, or null (unregistered ⇒ policy denies). */
export function getCapability(id: string): JarvisCapability | null {
  return Object.prototype.hasOwnProperty.call(CAPABILITY_REGISTRY, id)
    ? CAPABILITY_REGISTRY[id]
    : null;
}
