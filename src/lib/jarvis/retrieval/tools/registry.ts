import "server-only";

import type { JarvisContext } from "@/lib/jarvis/identity";
import type { LLMToolSpec } from "@/lib/jarvis/llm/provider";
import type { RetrieverContext } from "../types";
import type { ReadToolDescriptor, ReadToolOutcome } from "./types";
import { listClientsTool, aggregateTool } from "./portal-agency";
import { resolveClientTool, getClientOverviewTool, getClientDomainTool } from "./portal-client";

/**
 * Jarvis Milestone A — the FROZEN read-tool registry + executor.
 *
 * The registry is the model's entire read surface: it can invoke ONLY these names, with
 * ONLY schema-valid args. The executor is the single trusted boundary that validates
 * input, enforces the required grant, runs the read under the caller's RLS identity
 * (never service-role, never arbitrary SQL), and isolates failures per tool so one bad
 * tool never aborts the turn. Results are already bounded + secret-scanned by the tools.
 */

const TOOLS: ReadToolDescriptor[] = [
  // client-scoped
  resolveClientTool,
  getClientOverviewTool,
  getClientDomainTool,
  // agency-scoped
  listClientsTool,
  aggregateTool,
];

export const READ_TOOL_REGISTRY: ReadonlyMap<string, ReadToolDescriptor> = new Map(TOOLS.map((t) => [t.name, t]));

/** The tool schemas exposed to the provider (model-facing), derived from the registry. */
export function readToolSpecs(): LLMToolSpec[] {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

export function isRegisteredTool(name: string): boolean {
  return READ_TOOL_REGISTRY.has(name);
}

/**
 * Execute one model-requested tool call. Pure control flow around the tool's own
 * `parse`/`run`; never throws for expected failures. A per-call timeout is enforced by
 * the caller (the loop) via Promise.race — here we also guard against a thrown run().
 */
export async function executeReadTool(
  name: string,
  rawArgs: unknown,
  rc: RetrieverContext,
  ctx: JarvisContext
): Promise<ReadToolOutcome> {
  const tool = READ_TOOL_REGISTRY.get(name);
  // Unknown/arbitrary tool name ⇒ rejected (the model cannot invent tools).
  if (!tool) return { ok: false, status: "invalid_input", message: `unknown tool "${name}"` };

  // Grant enforcement — the principal must hold the tool's required grant.
  if (!ctx.grants.has(tool.requiredGrant)) {
    return { ok: false, status: "unauthorized", message: `missing grant ${tool.requiredGrant}` };
  }

  // Validate + narrow untrusted model input.
  const parsed = tool.parse(rawArgs);
  if (!parsed.ok) return { ok: false, status: "invalid_input", message: parsed.reason };

  try {
    const result = await tool.run(parsed.args, rc, ctx);
    return { ok: true, result };
  } catch {
    // Failure isolation: never leak the raw error; the loop continues with other tools.
    return { ok: false, status: "error", message: "tool execution failed" };
  }
}
