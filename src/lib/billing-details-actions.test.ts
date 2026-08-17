import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireClient: vi.fn(async () => ({ id: "client-profile-1", client_id: "client-A", role: "client" })),
  requireAdmin: vi.fn(async () => ({ id: "admin-profile-1", role: "admin" })),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { saveMyBillingDetailsAction, adminSaveBillingDetailsAction } from "./billing-details-actions";
import { createClient } from "@/lib/supabase/server";
import { EMPTY_BILLING_INPUT, type BillingDetailsInput } from "./billing-details";

/** Mock client: clients.select → contact row; client_billing_details.upsert captured. */
function makeClient(contactEmail: string | null, upsertError: unknown = null) {
  const captured: { table?: string; payload?: Record<string, unknown>; onConflict?: string } = {};
  const client = {
    from(table: string) {
      if (table === "clients") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: contactEmail === undefined ? null : { contact_email: contactEmail }, error: null }) }) }),
        };
      }
      // client_billing_details
      return {
        upsert: (payload: Record<string, unknown>, opts: { onConflict?: string }) => {
          captured.table = table; captured.payload = payload; captured.onConflict = opts?.onConflict;
          return Promise.resolve({ error: upsertError });
        },
      };
    },
  };
  vi.mocked(createClient).mockResolvedValue(client as never);
  return captured;
}

const valid = (over: Partial<BillingDetailsInput> = {}): BillingDetailsInput => ({
  ...EMPTY_BILLING_INPUT, invoice_name: "Acme", billing_email: "accounts@acme.com", ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("saveMyBillingDetailsAction (client self-service)", () => {
  it("upserts THIS session's client_id (never from input), stamps updated_by=self, onConflict=client_id", async () => {
    const cap = makeClient("contact@acme.com");
    // NOTE: the action signature takes NO client_id — the browser cannot supply one.
    const res = await saveMyBillingDetailsAction(valid());
    expect(res.ok).toBe(true);
    expect(cap.payload?.client_id).toBe("client-A"); // from requireClient session
    expect(cap.payload?.updated_by).toBe("client-profile-1");
    expect(cap.onConflict).toBe("client_id"); // same row → no duplicate per client
  });

  it("saves a PARTIAL profile (invoice_name only, no email)", async () => {
    const cap = makeClient("contact@acme.com");
    const res = await saveMyBillingDetailsAction(valid({ invoice_name: "Acme", billing_email: "" }));
    expect(res.ok).toBe(true);
    expect(cap.payload?.invoice_name).toBe("Acme");
    expect(cap.payload?.billing_email).toBeNull();
  });

  it("saves a PARTIAL profile (VAT + address only, no invoice_name/email)", async () => {
    const cap = makeClient(null);
    const res = await saveMyBillingDetailsAction(valid({ invoice_name: "", billing_email: "", vat_number: "4123456789", billing_address: "1 Main Rd" }));
    expect(res.ok).toBe(true);
    expect(cap.payload?.vat_number).toBe("4123456789");
    expect(cap.payload?.invoice_name).toBeNull();
  });

  it("REJECTS a malformed explicit billing email (field-level, still on partial)", async () => {
    makeClient("contact@acme.com");
    const res = await saveMyBillingDetailsAction(valid({ billing_email: "not-an-email" }));
    expect(res.ok).toBeUndefined();
    expect(res.fieldErrors?.billing_email).toBeTruthy();
  });

  it("REJECTS an over-length supplied field", async () => {
    makeClient("contact@acme.com");
    const res = await saveMyBillingDetailsAction(valid({ vat_number: "9".repeat(40) }));
    expect(res.ok).toBeUndefined();
    expect(res.fieldErrors?.vat_number).toBeTruthy();
  });
});

describe("adminSaveBillingDetailsAction", () => {
  it("upserts the SELECTED client's row, stamps updated_by=admin", async () => {
    const cap = makeClient("contact@acme.com");
    const res = await adminSaveBillingDetailsAction("client-Z", valid());
    expect(res.ok).toBe(true);
    expect(cap.payload?.client_id).toBe("client-Z");
    expect(cap.payload?.updated_by).toBe("admin-profile-1");
    expect(cap.onConflict).toBe("client_id");
  });

  it("allows a PARTIAL admin save (e.g. VAT number only)", async () => {
    const cap = makeClient("contact@acme.com");
    const res = await adminSaveBillingDetailsAction("client-Z", valid({ invoice_name: "", billing_email: "", vat_number: "4123456789" }));
    expect(res.ok).toBe(true);
    expect(cap.payload?.vat_number).toBe("4123456789");
  });
});
