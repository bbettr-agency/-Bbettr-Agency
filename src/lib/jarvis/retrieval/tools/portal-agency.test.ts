import { describe, it, expect } from "vitest";
import { listClientsTool, aggregateTool } from "./portal-agency";
import { makeFakeSupabase, type FakeRow } from "@/test/jarvis-fake-supabase";
import type { RetrieverContext } from "../types";
import type { JarvisContext } from "@/lib/jarvis/identity";

const NOW = new Date("2026-10-06T00:00:00Z");
const CTX = { principalId: "u1", workspaceId: "w1", grants: new Set(["portal.read"]) } as JarvisContext;

function rc(tables: Record<string, FakeRow[]>, throwOn?: string[]): RetrieverContext {
  return { ctx: CTX, supabase: makeFakeSupabase({ tables, throwOn }) as unknown as RetrieverContext["supabase"], now: () => NOW };
}

const CLIENTS: FakeRow[] = [
  { id: "c1", name: "A&S Wholesalers", status: "active" },
  { id: "c2", name: "DIAD Signs", status: "in_progress" },
  { id: "c3", name: "Imatec", status: "onboarding" },
  { id: "c4", name: "Cuisine Foods", status: "active" },
];

describe("portal_list_clients — parse", () => {
  it("rejects an unknown status / service / non-boolean flag", () => {
    expect(listClientsTool.parse({ status: "nope" }).ok).toBe(false);
    expect(listClientsTool.parse({ service: "tiktok" }).ok).toBe(false);
    expect(listClientsTool.parse({ has_open_tasks: "yes" }).ok).toBe(false);
    expect(listClientsTool.parse({ stale_updates_days: 0 }).ok).toBe(false);
    expect(listClientsTool.parse({ limit: 9999 }).ok).toBe(false);
  });
  it("accepts a valid filter set", () => {
    const p = listClientsTool.parse({ status: "active", has_overdue_tasks: true, limit: 10 });
    expect(p.ok).toBe(true);
  });
});

describe("portal_list_clients — deterministic filtering & counts", () => {
  it("returns authoritative total, shown count and truncation", async () => {
    const r = await listClientsTool.run({ limit: 2 }, rc({ clients: CLIENTS }), CTX);
    expect(r.total).toBe(4); // matched = all 4
    expect(r.shown).toBe(2);
    expect(r.truncated).toBe(true);
    expect(r.content).toContain("4 (of 4 total");
  });

  it("filters by status deterministically", async () => {
    const r = await listClientsTool.run({ status: "active" }, rc({ clients: CLIENTS }), CTX);
    expect(r.total).toBe(2);
    expect(r.content).toContain("A&S Wholesalers");
    expect(r.content).toContain("Cuisine Foods");
    expect(r.content).not.toContain("DIAD");
  });

  it("filters by has_overdue_tasks using only open, non-deleted, past-due tasks", async () => {
    const tasks: FakeRow[] = [
      { client_id: "c1", due_date: "2026-10-01" }, // overdue
      { client_id: "c2", due_date: "2026-12-01" }, // future (filtered out by .lt today)
    ];
    const r = await listClientsTool.run({ has_overdue_tasks: true }, rc({ clients: CLIENTS, tasks }), CTX);
    // Only c1 has an overdue task (the fake applies the .lt(today) predicate).
    expect(r.content).toContain("A&S Wholesalers");
    expect(r.total).toBe(1);
  });

  it("filters by incomplete_onboarding (submission not submitted/approved)", async () => {
    const onboarding_submissions: FakeRow[] = [
      { client_id: "c3", status: "in_progress" },
      { client_id: "c1", status: "approved" }, // excluded by .not in (submitted,approved)
    ];
    const r = await listClientsTool.run({ incomplete_onboarding: true }, rc({ clients: CLIENTS, onboarding_submissions }), CTX);
    expect(r.total).toBe(1);
    expect(r.content).toContain("Imatec");
  });

  it("secret-scans client names before returning them", async () => {
    const secret = "sk-A1b2C3d4E5f6G7h8I9j0K1l2";
    const r = await listClientsTool.run({}, rc({ clients: [{ id: "x", name: `Client ${secret}`, status: "active" }] }), CTX);
    expect(r.content).not.toContain(secret);
    expect(r.content).toContain("[REDACTED_SECRET]");
  });
});

describe("portal_aggregate — deterministic, app-computed facts", () => {
  it("clients_by_status counts in code", async () => {
    const r = await aggregateTool.run({ metric: "clients_by_status" }, rc({ clients: CLIENTS }), CTX);
    expect(r.content).toContain("active: 2");
    expect(r.content).toContain("in_progress: 1");
    expect(r.content).toContain("onboarding: 1");
  });

  it("overdue_tasks is a head count (code arithmetic, not the model's)", async () => {
    const tasks: FakeRow[] = [
      { id: "t1", status: "in_progress", deleted_at: null, due_date: "2026-10-01" },
      { id: "t2", status: "completed", deleted_at: null, due_date: "2026-10-01" }, // excluded (completed)
      { id: "t3", status: "planned", deleted_at: null, due_date: "2026-12-01" }, // excluded (future)
    ];
    const r = await aggregateTool.run({ metric: "overdue_tasks" }, rc({ tasks }), CTX);
    expect(r.total).toBe(1);
    expect(r.content).toContain("overdue tasks: 1");
  });

  it("unpaid_invoices reports PER CURRENCY and never combines currencies", async () => {
    const client_invoices: FakeRow[] = [
      { amount: 1000, currency: "ZAR", status: "sent" },
      { amount: 500, currency: "ZAR", status: "sent" },
      { amount: 200, currency: "USD", status: "sent" },
      { amount: 999, currency: "ZAR", status: "paid" }, // excluded (paid)
    ];
    const r = await aggregateTool.run({ metric: "unpaid_invoices" }, rc({ client_invoices }), CTX);
    expect(r.content).toContain("unpaid (sent) invoices: 3");
    expect(r.content).toContain("ZAR: 2 invoice(s), outstanding ZAR 1500");
    expect(r.content).toContain("USD: 1 invoice(s), outstanding USD 200");
    expect(r.content).toContain("do NOT combine currencies");
    // never a single combined total / invented symbol
    expect(r.content).not.toContain("1700");
    expect(r.content).not.toContain("$");
  });

  it("unpaid invoices with no currency are counted but never summed or assigned a currency", async () => {
    const client_invoices: FakeRow[] = [{ amount: 50, currency: "", status: "sent" }];
    const r = await aggregateTool.run({ metric: "unpaid_invoices" }, rc({ client_invoices }), CTX);
    expect(r.content).toContain("no stated currency");
    expect(r.content).not.toContain("$");
  });

  it("stale_clients requires stale_days and flags clients with no recent update", async () => {
    expect(aggregateTool.parse({ metric: "stale_clients" }).ok).toBe(false); // missing stale_days
    const updates: FakeRow[] = [{ client_id: "c1", published_at: "2026-10-05T00:00:00Z" }]; // recent
    const r = await aggregateTool.run({ metric: "stale_clients", stale_days: 7 }, rc({ clients: CLIENTS, updates }), CTX);
    // c2,c3,c4 have no update ⇒ stale; c1 is recent ⇒ not stale.
    expect(r.total).toBe(3);
  });
});
