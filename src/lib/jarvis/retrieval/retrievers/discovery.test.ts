import { describe, it, expect } from "vitest";
import { retrieveClientDiscovery, DISCOVERY_FULL_LIMIT } from "./discovery";
import type { RetrieverContext } from "../types";

/**
 * Deterministic discovery counting/grouping. The COUNTS the model is shown are
 * computed here, not by the model — these tests lock the arithmetic invariants so a
 * total/group mismatch can never slip through to the provider block.
 */

type Row = { id: string; name: string; status: string };

/** Minimal thenable query builder mimicking the supabase chain used by discovery. */
function fakeRc(rows: Row[], total: number, throwErr = false): RetrieverContext {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.order = chain;
  builder.limit = () => {
    if (throwErr) return Promise.reject(new Error("boom"));
    return Promise.resolve({ data: rows.slice(0, DISCOVERY_FULL_LIMIT), count: total });
  };
  const supabase = { from: () => builder };
  return { ctx: {}, supabase, now: () => new Date() } as unknown as RetrieverContext;
}

describe("retrieveClientDiscovery — deterministic counts & grouping", () => {
  const rows: Row[] = [
    { id: "1", name: "Imatec", status: "active" },
    { id: "2", name: "A&S Wholesalers", status: "active" },
    { id: "3", name: "DIAD", status: "paused" },
    { id: "4", name: "Cuisine Foods", status: "active" },
    { id: "5", name: "Old Co", status: "archived" },
  ];

  it("sum of group counts equals shown, and groups cover every row", async () => {
    const d = await retrieveClientDiscovery(fakeRc(rows, rows.length));
    expect(d.status).toBe("ok");
    const summed = d.groups.reduce((s, g) => s + g.count, 0);
    expect(summed).toBe(d.shown);
    expect(d.shown).toBe(rows.length);
    const clientsInGroups = d.groups.reduce((s, g) => s + g.clients.length, 0);
    expect(clientsInGroups).toBe(rows.length);
  });

  it("each group.count equals its own clients array length", async () => {
    const d = await retrieveClientDiscovery(fakeRc(rows, rows.length));
    for (const g of d.groups) expect(g.count).toBe(g.clients.length);
  });

  it("groups are ordered by status, clients by name — fully deterministic", async () => {
    const a = await retrieveClientDiscovery(fakeRc(rows, rows.length));
    const b = await retrieveClientDiscovery(fakeRc([...rows].reverse(), rows.length));
    expect(a.groups.map((g) => g.status)).toEqual(["active", "archived", "paused"]);
    // Same rows in a different order ⇒ identical grouping/counts.
    expect(a.groups).toEqual(b.groups);
    const active = a.groups.find((g) => g.status === "active")!;
    expect(active.clients.map((c) => c.name)).toEqual(["A&S Wholesalers", "Cuisine Foods", "Imatec"]);
  });

  it("truncated when total exceeds retrieved rows; shown never exceeds total", async () => {
    const d = await retrieveClientDiscovery(fakeRc(rows, 120));
    expect(d.total).toBe(120);
    expect(d.truncated).toBe(true);
    expect(d.shown).toBeLessThanOrEqual(d.total);
  });

  it("empty and error are distinct and carry zeroed counts", async () => {
    const empty = await retrieveClientDiscovery(fakeRc([], 0));
    expect(empty.status).toBe("empty");
    expect(empty.groups).toEqual([]);
    const err = await retrieveClientDiscovery(fakeRc(rows, rows.length, true));
    expect(err.status).toBe("error");
    expect(err.total).toBe(0);
    expect(err.groups).toEqual([]);
  });
});
