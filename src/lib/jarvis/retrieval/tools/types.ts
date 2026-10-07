import "server-only";

import type { JarvisContext } from "@/lib/jarvis/identity";
import type { RetrieverContext } from "../types";

/**
 * Jarvis Milestone A — the general READ-TOOL contract.
 *
 * A thin generalization of the Slice-1 RetrieverDescriptor so the agentic loop can
 * expose BOTH client-scoped and agency/workspace-scoped Portal reads (and, later,
 * connector reads) as model-invokable tools — WITHOUT a new framework. Every tool:
 *   • declares a JSON-Schema input the model fills (never ids/SQL it invents),
 *   • is parsed/narrowed by trusted code before use,
 *   • requires a capability grant the executor enforces,
 *   • runs under the authenticated principal's RLS identity (never service-role),
 *   • returns a BOUNDED, secret-scanned text block + safe counts/provenance.
 * The registry is a FROZEN allowlist — the model can invoke ONLY these names.
 */

/** Data-sensitivity class of a tool's scope (for the safe trace, never for authz). */
export type ToolScope = "agency" | "client";

export interface ReadToolResult {
  /** Secret-scanned, bounded text handed back to the model as tool_result content. */
  content: string;
  /** Deterministic counts for the safe trace (never raw rows). */
  total: number | null;
  shown: number;
  truncated: boolean;
  /** Safe provenance: the Portal domains/tables this tool read (names only). */
  domains: string[];
  /** True when a depended-on read could NOT be retrieved (e.g. a domain errored in an
   *  overview). The loop uses this to make the turn's app-owned confidence "qualified".
   *  Bounded/truncated lists are COVERAGE, not degradation, and never set this. */
  degraded?: boolean;
}

export type ReadToolOutcome =
  | { ok: true; result: ReadToolResult }
  | { ok: false; status: "invalid_input" | "unauthorized" | "error" | "timeout"; message: string };

export interface ReadToolDescriptor<A = unknown> {
  /** Model-facing tool name (snake_case, e.g. "portal_list_clients"). */
  name: string;
  description: string;
  /** JSON Schema the model fills. `additionalProperties:false` — no smuggled keys. */
  inputSchema: Record<string, unknown>;
  scope: ToolScope;
  /** Capability grant the principal must hold (enforced by the executor). */
  requiredGrant: string;
  /** Validate + narrow untrusted model input. Never throws. */
  parse(raw: unknown): { ok: true; args: A } | { ok: false; reason: string };
  /** Execute the bounded read under RLS. Must not throw for expected failures. */
  run(args: A, rc: RetrieverContext, ctx: JarvisContext): Promise<ReadToolResult>;
}
