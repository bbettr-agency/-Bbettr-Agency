import { describe, it, expect, beforeEach, vi } from "vitest";

// The shared final-submit gate: a NEW onboarding submission requires a complete
// client-level billing profile; draft saves are never blocked; existing
// submissions aren't re-validated (the gate runs only on a fresh submit call).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireClient: vi.fn(async () => ({ id: "p1", client_id: "client-A", role: "client" })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/intake-advance", () => ({ advanceIntakeStatus: vi.fn(async () => {}) }));
vi.mock("@/lib/email/client-notifications", () => ({ sendOnboardingAssistanceEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/services", () => ({ SERVICES: { website: { name: "Website" } } }));

import { saveOnboarding } from "./actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Session client: billing + clients reads for the gate; onboarding upsert ok. */
function sessionClient({ billing, contactEmail }: { billing: Record<string, unknown> | null; contactEmail: string | null }) {
  const onboardingUpsert = vi.fn(() => ({ select: () => ({ single: async () => ({ data: { id: "sub-1" }, error: null }) }) }));
  const client = {
    from(table: string) {
      if (table === "client_billing_details")
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: billing, error: null }) }) }) };
      if (table === "clients")
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { contact_email: contactEmail }, error: null }) }) }) };
      if (table === "onboarding_submissions") return { upsert: onboardingUpsert };
      return {};
    },
  };
  return { client, onboardingUpsert };
}
function adminClient() {
  const mk = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {
      update: () => c, eq: () => c, in: () => c, select: () => c,
      order: async () => ({ data: [], error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
    };
    return c;
  };
  return { from: () => mk() };
}

const COMPLETE = { invoice_name: "Acme", billing_email: "a@b.com", billing_email_same_as_contact: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createAdminClient).mockReturnValue(adminClient() as never);
});

describe("saveOnboarding billing gate", () => {
  it("BLOCKS a final submit when billing is incomplete — and writes nothing", async () => {
    const { client, onboardingUpsert } = sessionClient({ billing: null, contactEmail: "c@x.com" });
    vi.mocked(createClient).mockResolvedValue(client as never);
    const res = await saveOnboarding("website" as never, { field: 1 }, true);
    expect(res.error).toMatch(/billing details/i);
    expect(onboardingUpsert).not.toHaveBeenCalled(); // not marked submitted
  });

  it("ALLOWS a final submit when billing is complete", async () => {
    const { client, onboardingUpsert } = sessionClient({ billing: COMPLETE, contactEmail: null });
    vi.mocked(createClient).mockResolvedValue(client as never);
    const res = await saveOnboarding("website" as never, { field: 1 }, true);
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(onboardingUpsert).toHaveBeenCalled();
  });

  it("does NOT block a DRAFT save even when billing is incomplete", async () => {
    const { client, onboardingUpsert } = sessionClient({ billing: null, contactEmail: null });
    vi.mocked(createClient).mockResolvedValue(client as never);
    const res = await saveOnboarding("website" as never, { field: 1 }, false);
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(onboardingUpsert).toHaveBeenCalled(); // draft persisted
  });

  it("same-as-contact completes the gate only with a valid account email", async () => {
    const withFlag = { invoice_name: "Acme", billing_email: null, billing_email_same_as_contact: true };
    // No account email → still blocked.
    let s = sessionClient({ billing: withFlag, contactEmail: null });
    vi.mocked(createClient).mockResolvedValue(s.client as never);
    expect((await saveOnboarding("website" as never, {}, true)).error).toMatch(/billing details/i);
    // Valid account email → allowed.
    s = sessionClient({ billing: withFlag, contactEmail: "c@x.com" });
    vi.mocked(createClient).mockResolvedValue(s.client as never);
    expect((await saveOnboarding("website" as never, {}, true)).ok).toBe(true);
  });
});
