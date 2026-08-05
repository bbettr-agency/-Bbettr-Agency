import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/revalidate", () => ({ revalidateClient: vi.fn() }));

import { addClientServiceAction } from "@/app/(admin)/admin/actions";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { revalidateClient } from "@/lib/revalidate";

const ADMIN = { id: "admin-1", role: "admin", full_name: "Eloff Sander", email: "e@b.com", client_id: null };

type Scenario = { clientExists?: boolean; serviceExists?: boolean; insertError?: { code?: string } | null };
const inserts: Array<{ table: string; row: unknown }> = [];

function mockSupabase(s: Scenario) {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      single: async () => (table === "clients" ? (s.clientExists ? { data: { id: "c1", name: "Vision Motors" }, error: null } : { data: null, error: { message: "nf" } }) : { data: null, error: null }),
      maybeSingle: async () => (table === "client_services" ? { data: s.serviceExists ? { id: "cs1" } : null, error: null } : { data: null, error: null }),
      insert: async (row: unknown) => { inserts.push({ table, row }); return { error: s.insertError ?? null }; },
    };
    return b;
  };
  return { from: (t: string) => builder(t) };
}

beforeEach(() => {
  inserts.length = 0;
  vi.mocked(requireAdmin).mockResolvedValue(ADMIN as never);
  vi.mocked(logActivity).mockReset();
  vi.mocked(revalidateClient).mockReset();
  vi.mocked(createClient).mockReset();
});

describe("addClientServiceAction", () => {
  it("rejects an unsupported service before any DB access", async () => {
    const res = await addClientServiceAction("c1", "bogus" as never);
    expect(res).toMatchObject({ error: expect.stringMatching(/unsupported/i) });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns 'Client not found' when the client does not exist (no insert)", async () => {
    vi.mocked(createClient).mockResolvedValue(mockSupabase({ clientExists: false }) as never);
    const res = await addClientServiceAction("c1", "google_ads");
    expect(res).toMatchObject({ error: expect.stringMatching(/not found/i) });
    expect(inserts).toHaveLength(0);
  });

  it("inserts the missing service exactly once at not_started; audits with the admin identity; revalidates", async () => {
    vi.mocked(createClient).mockResolvedValue(mockSupabase({ clientExists: true, serviceExists: false }) as never);
    const res = await addClientServiceAction("c1", "google_ads");
    expect(res).toEqual({ ok: true });
    expect(inserts).toEqual([{ table: "client_services", row: { client_id: "c1", service: "google_ads", onboarding_status: "not_started" } }]);
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logActivity).mock.calls[0][0]).toMatchObject({
      clientId: "c1", type: "service_added", visibility: "internal", createdBy: "admin-1", source: "manual",
    });
    expect(vi.mocked(logActivity).mock.calls[0][0].description).toContain("Eloff Sander");
    expect(revalidateClient).toHaveBeenCalledWith("c1");
  });

  it("never touches onboarding_submissions or project_stages", async () => {
    vi.mocked(createClient).mockResolvedValue(mockSupabase({ clientExists: true, serviceExists: false }) as never);
    await addClientServiceAction("c1", "meta_ads");
    expect(inserts.every((i) => i.table === "client_services")).toBe(true);
    expect(inserts.some((i) => i.table === "onboarding_submissions" || i.table === "project_stages")).toBe(false);
  });

  it("is idempotent: an already-existing service returns alreadyAdded with NO insert, NO audit, NO reset", async () => {
    vi.mocked(createClient).mockResolvedValue(mockSupabase({ clientExists: true, serviceExists: true }) as never);
    const res = await addClientServiceAction("c1", "website");
    expect(res).toEqual({ ok: true, alreadyAdded: true });
    expect(inserts).toHaveLength(0); // never re-inserts / upserts / resets
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("treats a unique-violation race (23505) as a safe alreadyAdded no-op", async () => {
    vi.mocked(createClient).mockResolvedValue(mockSupabase({ clientExists: true, serviceExists: false, insertError: { code: "23505" } }) as never);
    const res = await addClientServiceAction("c1", "seo");
    expect(res).toEqual({ ok: true, alreadyAdded: true });
  });

  it("is admin-gated (requireAdmin is invoked; clients/reps are redirected by it)", async () => {
    vi.mocked(createClient).mockResolvedValue(mockSupabase({ clientExists: true, serviceExists: false }) as never);
    await addClientServiceAction("c1", "google_ads");
    expect(requireAdmin).toHaveBeenCalled();
  });
});
