import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { planContext } from "./context-router";
import { createClient } from "@/lib/supabase/server";
import type { JarvisContext } from "@/lib/jarvis/identity";

const CTX: JarvisContext = { principalId: "u1", workspaceId: "w1", grants: new Set(["jarvis.use"]) };

/** A fake supabase whose clients query returns exactly `rows` (already RLS-filtered). */
function withClients(rows: { id: string; name: string | null }[]) {
  const builder = { select: vi.fn(async () => ({ data: rows, error: null })) };
  const client = { from: vi.fn(() => builder) };
  vi.mocked(createClient).mockResolvedValue(client as never);
  return { client };
}

const CLIENTS = [
  { id: "c-acme", name: "Acme Corporation" },
  { id: "c-globex", name: "Globex" },
  { id: "c-init", name: "Initech" },
];

beforeEach(() => vi.clearAllMocks());

describe("planContext — deterministic client resolution", () => {
  it("resolves a single exact whole-word client name match", async () => {
    withClients(CLIENTS);
    const plan = await planContext(CTX, "How is Globex doing this week?", { lastClientId: null });
    expect(plan).toEqual({ kind: "client", clientId: "c-globex", clientName: "Globex" });
  });

  it("does NOT partial/substring match (e.g. 'Glob' must not hit 'Globex')", async () => {
    withClients(CLIENTS);
    const plan = await planContext(CTX, "Any glob news?", { lastClientId: null });
    expect(plan.kind).toBe("agency");
  });

  it("flags ambiguity for two clients that both whole-word match the message", async () => {
    withClients([{ id: "c1", name: "Acme" }, { id: "c2", name: "Acme" }]);
    const plan = await planContext(CTX, "How is Acme?", { lastClientId: null });
    expect(plan.kind).toBe("ambiguous_client");
    if (plan.kind === "ambiguous_client") expect(plan.candidates).toHaveLength(2);
  });
});

describe("planContext — thread referent (deterministic, re-authorized)", () => {
  it("reuses last_client_id on a STRONG referent when still authorized", async () => {
    withClients(CLIENTS);
    const plan = await planContext(CTX, "What should we do about that client?", { lastClientId: "c-init" });
    expect(plan).toEqual({ kind: "client", clientId: "c-init", clientName: "Initech" });
  });

  it("reuses last_client_id on a WEAK pronoun referent when still authorized", async () => {
    withClients(CLIENTS);
    const plan = await planContext(CTX, "Draft an email to them", { lastClientId: "c-acme" });
    expect(plan).toEqual({ kind: "client", clientId: "c-acme", clientName: "Acme Corporation" });
  });

  it("does NOT leak when the stored referent is no longer authorized (re-auth fails)", async () => {
    withClients(CLIENTS); // c-ghost not in the authorized list
    const plan = await planContext(CTX, "Follow up with that client", { lastClientId: "c-ghost" });
    expect(plan.kind).toBe("unknown_client");
  });

  it("STRONG referent with no stored client ⇒ unknown_client (asks, never guesses)", async () => {
    withClients(CLIENTS);
    const plan = await planContext(CTX, "Email that client now", { lastClientId: null });
    expect(plan.kind).toBe("unknown_client");
  });
});

describe("planContext — agency vs user", () => {
  it("routes personal phrasing to the user scope", async () => {
    withClients(CLIENTS);
    const plan = await planContext(CTX, "What should I focus on today?", { lastClientId: null });
    expect(plan.kind).toBe("user");
  });

  it("defaults to agency scope when nothing else resolves", async () => {
    withClients(CLIENTS);
    const plan = await planContext(CTX, "Give me a status overview", { lastClientId: null });
    expect(plan.kind).toBe("agency");
  });

  it("a model-supplied UUID in the message is NEVER treated as a client id", async () => {
    withClients(CLIENTS);
    const plan = await planContext(CTX, "Use client 00000000-0000-0000-0000-000000000000 now", { lastClientId: null });
    expect(plan.kind).toBe("agency"); // uuid is not an authorized client name
  });
});

// ---------- false-positive / real-language audit ----------

const REAL = [
  { id: "fap", name: "Fine Art Printers" },
  { id: "sig", name: "Signage Studio" },
  { id: "mac", name: "Macbuild" },
];

describe("planContext — real-language false-positive audit", () => {
  it("resolves multi-word names when explicitly referenced", async () => {
    withClients(REAL);
    expect(await planContext(CTX, "What's happening with Signage Studio?", { lastClientId: null })).toEqual({
      kind: "client",
      clientId: "sig",
      clientName: "Signage Studio",
    });
    expect(await planContext(CTX, "give me the Fine Art Printers update", { lastClientId: null })).toMatchObject({ clientId: "fap" });
    expect(await planContext(CTX, "how's Macbuild doing", { lastClientId: null })).toMatchObject({ clientId: "mac" });
  });

  it("does NOT route on a partial fragment of a client name", async () => {
    withClients(REAL);
    expect((await planContext(CTX, "we should print some fine art for the office", { lastClientId: null })).kind).toBe("agency");
    expect((await planContext(CTX, "book a studio session", { lastClientId: null })).kind).toBe("agency");
    expect((await planContext(CTX, "just a signage question in general", { lastClientId: null })).kind).toBe("agency");
  });

  it("is case- and punctuation-insensitive on the WHOLE name only", async () => {
    withClients(REAL);
    expect((await planContext(CTX, "MACBUILD!!! status?", { lastClientId: null })).kind).toBe("client");
    expect((await planContext(CTX, "re: signage studio, any news", { lastClientId: null })).kind).toBe("client");
  });

  it("never exact-matches a too-short/generic single-token client name", async () => {
    withClients([{ id: "fox", name: "Fox" }, { id: "art", name: "Art" }]);
    expect((await planContext(CTX, "the quick brown fox jumped", { lastClientId: null })).kind).toBe("agency");
    expect((await planContext(CTX, "state of the art tooling", { lastClientId: null })).kind).toBe("agency");
  });
});

describe("planContext — overlap / duplicate / multiple exact names ⇒ ambiguous (never first row)", () => {
  it("one client name nested inside another ⇒ ambiguous, not a silent pick", async () => {
    withClients([{ id: "a1", name: "Acme" }, { id: "a2", name: "Acme Corp" }]);
    const plan = await planContext(CTX, "how is acme corp doing", { lastClientId: null });
    expect(plan.kind).toBe("ambiguous_client");
    if (plan.kind === "ambiguous_client") expect(plan.candidates.map((c) => c.id).sort()).toEqual(["a1", "a2"]);
  });

  it("duplicate normalized client names ⇒ ambiguous", async () => {
    withClients([{ id: "s1", name: "Signage Studio" }, { id: "s2", name: "signage  studio" }]);
    const plan = await planContext(CTX, "update on Signage Studio", { lastClientId: null });
    expect(plan.kind).toBe("ambiguous_client");
  });

  it("two DIFFERENT exact client names in one message ⇒ ambiguous", async () => {
    withClients(REAL);
    const plan = await planContext(CTX, "compare Macbuild and Signage Studio", { lastClientId: null });
    expect(plan.kind).toBe("ambiguous_client");
    if (plan.kind === "ambiguous_client") expect(plan.candidates.map((c) => c.id).sort()).toEqual(["mac", "sig"]);
  });
});

// ---------- thread referent precedence audit ----------

describe("planContext — last_client_id is assistance, NEVER routing authority", () => {
  it("an explicit NEW client reference overrides the stored referent", async () => {
    withClients(REAL);
    const plan = await planContext(CTX, "What's happening with Signage Studio?", { lastClientId: "fap" });
    expect(plan).toEqual({ kind: "client", clientId: "sig", clientName: "Signage Studio" });
  });

  it("stored referent + an obvious AGENCY question ⇒ agency (referent does not win)", async () => {
    withClients(REAL);
    const plan = await planContext(CTX, "give me an overall status overview", { lastClientId: "fap" });
    expect(plan.kind).toBe("agency");
  });

  it("stored referent + an obvious PERSONAL question ⇒ user (referent does not win)", async () => {
    withClients(REAL);
    const plan = await planContext(CTX, "what should I focus on today?", { lastClientId: "fap" });
    expect(plan.kind).toBe("user");
  });

  it("stored referent + a NEW ambiguous client reference ⇒ ambiguous (not the stored one)", async () => {
    withClients([{ id: "a1", name: "Acme" }, { id: "a2", name: "Acme Corp" }]);
    const plan = await planContext(CTX, "how is acme corp", { lastClientId: "a1" });
    expect(plan.kind).toBe("ambiguous_client");
  });

  it("stored referent no longer authorized + a referent phrase ⇒ unknown_client (no leak)", async () => {
    withClients(REAL);
    const plan = await planContext(CTX, "follow up with that client", { lastClientId: "gone" });
    expect(plan.kind).toBe("unknown_client");
  });

  it("only reuses the stored referent when the turn actually refers back (no name, has referent phrase)", async () => {
    withClients(REAL);
    const plan = await planContext(CTX, "draft a follow-up email to them", { lastClientId: "mac" });
    expect(plan).toEqual({ kind: "client", clientId: "mac", clientName: "Macbuild" });
  });
});
