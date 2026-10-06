import { describe, it, expect } from "vitest";
import { executeReadTool, readToolSpecs, isRegisteredTool, READ_TOOL_REGISTRY } from "./registry";
import { makeFakeSupabase, type FakeRow } from "@/test/jarvis-fake-supabase";
import type { RetrieverContext } from "../types";
import type { JarvisContext } from "@/lib/jarvis/identity";

const NOW = new Date("2026-10-06T00:00:00Z");
const withGrant = { principalId: "u1", workspaceId: "w1", grants: new Set(["portal.read"]) } as JarvisContext;
const noGrant = { principalId: "u1", workspaceId: "w1", grants: new Set<string>() } as JarvisContext;

function rc(tables: Record<string, FakeRow[]> = {}, throwOn?: string[]): RetrieverContext {
  return { ctx: withGrant, supabase: makeFakeSupabase({ tables, throwOn }) as unknown as RetrieverContext["supabase"], now: () => NOW };
}

describe("read-tool registry", () => {
  it("exposes a small, frozen, named tool surface", () => {
    const names = readToolSpecs().map((t) => t.name).sort();
    expect(names).toEqual(
      ["portal_aggregate", "portal_get_client_domain", "portal_get_client_overview", "portal_list_clients", "portal_resolve_client"].sort()
    );
    // every spec has an object input schema with additionalProperties:false
    for (const spec of readToolSpecs()) {
      expect(spec.inputSchema.type).toBe("object");
      expect(spec.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("isRegisteredTool only matches registered names", () => {
    expect(isRegisteredTool("portal_aggregate")).toBe(true);
    expect(isRegisteredTool("execute_sql")).toBe(false);
    expect(READ_TOOL_REGISTRY.has("portal_drop_table")).toBe(false);
  });
});

describe("executeReadTool — the trusted boundary", () => {
  it("rejects an unknown/arbitrary tool name (model cannot invent tools)", async () => {
    const out = await executeReadTool("execute_sql", { q: "select 1" }, rc(), withGrant);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe("invalid_input");
  });

  it("enforces the required grant (unauthorized when missing)", async () => {
    const out = await executeReadTool("portal_aggregate", { metric: "clients_by_status" }, rc(), noGrant);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe("unauthorized");
  });

  it("validates tool input before running (invalid args rejected)", async () => {
    const out = await executeReadTool("portal_aggregate", { metric: "rm -rf" }, rc(), withGrant);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe("invalid_input");
  });

  it("isolates failures — a throwing read becomes a typed error, never a thrown turn", async () => {
    // tasks table throws → the tool's run() throws → executor returns status:"error".
    const out = await executeReadTool("portal_aggregate", { metric: "overdue_tasks" }, rc({}, ["tasks"]), withGrant);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe("error");
      expect(out.message).not.toContain("boom"); // raw error never leaked
    }
  });

  it("runs under the SUPPLIED RLS client (no service-role substitution)", async () => {
    // The only data the tool can see is what the injected RLS client returns.
    const supplied = rc({ clients: [{ id: "c1", name: "A&S", status: "active" }] });
    const out = await executeReadTool("portal_aggregate", { metric: "clients_by_status" }, supplied, withGrant);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.content).toContain("active: 1");
  });
});
