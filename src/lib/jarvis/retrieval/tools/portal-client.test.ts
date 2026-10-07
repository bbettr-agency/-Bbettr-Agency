import { describe, it, expect } from "vitest";
import { resolveClientTool, getClientOverviewTool, getClientDomainTool } from "./portal-client";
import { makeFakeSupabase, type FakeRow } from "@/test/jarvis-fake-supabase";
import type { RetrieverContext } from "../types";
import type { JarvisContext } from "@/lib/jarvis/identity";

const NOW = new Date("2026-10-06T00:00:00Z");
const CTX = { principalId: "u1", workspaceId: "w1", grants: new Set(["portal.read"]) } as JarvisContext;
function rc(tables: Record<string, FakeRow[]> = {}): RetrieverContext {
  return { ctx: CTX, supabase: makeFakeSupabase({ tables }) as unknown as RetrieverContext["supabase"], now: () => NOW };
}

const CLIENTS: FakeRow[] = [
  { id: "c1", name: "A&S Wholesalers", company: null },
  { id: "c2", name: "DIAD Signs", company: null },
  { id: "c3", name: "Fine Art Printers", company: null },
  { id: "c4", name: "Fine Art Studio", company: null },
];

describe("portal_resolve_client", () => {
  it("returns exactly one match for a clear reference", async () => {
    const r = await resolveClientTool.run({ query: "A&S" }, rc({ clients: CLIENTS }), CTX);
    expect(r.total).toBe(1);
    expect(r.content).toContain("A&S Wholesalers");
    expect(r.content).toContain("id: c1");
  });
  it("returns candidates for an ambiguous reference (ask which)", async () => {
    const r = await resolveClientTool.run({ query: "Fine Art" }, rc({ clients: CLIENTS }), CTX);
    expect(r.total).toBe(2);
    expect(r.content).toContain("Fine Art Printers");
    expect(r.content).toContain("Fine Art Studio");
  });
  it("returns none for an unknown client (never invents one)", async () => {
    const r = await resolveClientTool.run({ query: "Globex" }, rc({ clients: CLIENTS }), CTX);
    expect(r.total).toBe(0);
    expect(r.content).toContain("No Portal client matches");
  });
  it("rejects empty/oversized query", () => {
    expect(resolveClientTool.parse({ query: "" }).ok).toBe(false);
    expect(resolveClientTool.parse({ query: "x".repeat(201) }).ok).toBe(false);
  });
});

describe("portal_get_client_domain", () => {
  it("EXCLUDES PII / on-demand domains from the model-facing enum", () => {
    expect(getClientDomainTool.parse({ client_id: "c1", domain: "billing_details" }).ok).toBe(false);
    expect(getClientDomainTool.parse({ client_id: "c1", domain: "people" }).ok).toBe(false);
    expect(getClientDomainTool.parse({ client_id: "c1", domain: "update_questions" }).ok).toBe(false);
  });
  it("accepts an operational domain + memory", () => {
    expect(getClientDomainTool.parse({ client_id: "c1", domain: "tasks" }).ok).toBe(true);
    expect(getClientDomainTool.parse({ client_id: "c1", domain: "memory" }).ok).toBe(true);
  });
  it("returns a safe not-found for an id the principal cannot read (RLS)", async () => {
    const r = await getClientDomainTool.run({ client_id: "zzz", domain: "tasks" }, rc({ clients: CLIENTS }), CTX);
    expect(r.total).toBe(0);
    expect(r.content).toContain("No readable client");
  });
});

describe("portal_get_client_overview", () => {
  it("rejects a missing/oversized client_id", () => {
    expect(getClientOverviewTool.parse({}).ok).toBe(false);
    expect(getClientOverviewTool.parse({ client_id: "x".repeat(65) }).ok).toBe(false);
  });
  it("returns a safe not-found for an unreadable id (never asserts existence)", async () => {
    const r = await getClientOverviewTool.run({ client_id: "zzz" }, rc({ clients: CLIENTS }), CTX);
    expect(r.total).toBe(0);
    expect(r.content).toContain("No readable client");
  });
});
