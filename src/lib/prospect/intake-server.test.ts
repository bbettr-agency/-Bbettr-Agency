import { describe, it, expect, vi } from "vitest";
import {
  createGenericDraft,
  saveIntakeDraft,
  submitIntake,
  resolveIntakeView,
  HONEYPOT_FIELD,
  type ProspectIntakeStore,
  type StoredIntake,
  type TurnstileVerifier,
  type PromotedColumns,
} from "./intake-server";
import { issueIntakeToken, hashIntakeToken } from "./intake-token";
import { normalizeIntakeData } from "./intake-normalize";

// ── Fakes ────────────────────────────────────────────────────────────────────
interface Row extends StoredIntake {
  token_hash: string;
  columns?: PromotedColumns;
  submitted_at?: string;
}
function makeStore(seed: Row[] = []) {
  const byId = new Map<string, Row>();
  const byHash = new Map<string, string>();
  let seq = 0;
  const insertSpy = vi.fn();
  for (const r of seed) {
    byId.set(r.id, { ...r });
    byHash.set(r.token_hash, r.id);
  }
  const store: ProspectIntakeStore = {
    async insertDraft(input) {
      insertSpy(input);
      const id = `id${++seq}`;
      byId.set(id, {
        id, status: "draft", source: input.source,
        token_expires_at: input.token_expires_at, data: input.data,
        token_hash: input.token_hash, columns: input.columns,
      });
      byHash.set(input.token_hash, id);
      return { id };
    },
    async findByTokenHash(h) {
      const id = byHash.get(h);
      if (!id) return null;
      const r = byId.get(id)!;
      return { id: r.id, status: r.status, source: r.source, token_expires_at: r.token_expires_at, data: r.data };
    },
    async updateDraftData(id, data, columns) {
      const r = byId.get(id);
      if (!r || r.status !== "draft") return false;
      r.data = data; r.columns = columns;
      return true;
    },
    async claimSubmit(id, data, columns, at) {
      const r = byId.get(id);
      if (!r || r.status !== "draft") return false;
      r.status = "submitted"; r.data = data; r.columns = columns; r.submitted_at = at;
      return true;
    },
  };
  return { store, byId, byHash, insertSpy };
}
const okVerifier: TurnstileVerifier = { verify: async () => ({ ok: true, configured: true }) };
const failVerifier: TurnstileVerifier = { verify: async () => ({ ok: false, configured: true }) };
const unconfigured: TurnstileVerifier = { verify: async () => ({ ok: false, configured: false }) };

function seedDraft(overrides: Partial<Row> = {}, now = new Date("2026-01-01T00:00:00Z")) {
  const tok = issueIntakeToken(now);
  const data = normalizeIntakeData({
    contact_name: "Ada", business_name: "Acme", email: "ada@acme.co.za",
    selected_services: ["seo"], keywords: ["plumber"],
    _prefill: { email: "admin@acme.co.za" },
    ...(overrides.data as object),
  });
  const row: Row = {
    id: "seed1", status: "draft", source: "generic",
    token_expires_at: tok.expiresAt, token_hash: tok.tokenHash, data,
    ...overrides,
  };
  return { row, rawToken: tok.rawToken, now };
}

const validStep1 = {
  contact_name: "Ada", business_name: "Acme", email: "Ada@Acme.co.za",
  turnstileToken: "tok",
};

describe("createGenericDraft — no row before every gate passes", () => {
  it("honeypot filled → no row, generic result", async () => {
    const { store, insertSpy } = makeStore();
    const r = await createGenericDraft(store, okVerifier, { ...validStep1, honeypot: "bot" });
    expect(r.kind).toBe("verification_failed");
    expect(insertSpy).not.toHaveBeenCalled();
  });
  it("Turnstile unconfigured → configuration_error, no row (fail closed)", async () => {
    const { store, insertSpy } = makeStore();
    expect((await createGenericDraft(store, unconfigured, validStep1)).kind).toBe("configuration_error");
    expect(insertSpy).not.toHaveBeenCalled();
  });
  it("Turnstile fail → verification_failed, no row", async () => {
    const { store, insertSpy } = makeStore();
    expect((await createGenericDraft(store, failVerifier, validStep1)).kind).toBe("verification_failed");
    expect(insertSpy).not.toHaveBeenCalled();
  });
  it("invalid step 1 → validation_error, no row", async () => {
    const { store, insertSpy } = makeStore();
    const r = await createGenericDraft(store, okVerifier, { contact_name: "A", business_name: "B", turnstileToken: "t" });
    expect(r.kind).toBe("validation_error");
    expect(insertSpy).not.toHaveBeenCalled();
  });
  it("valid → success; hash-only stored; source generic; columns synced; view has no secrets", async () => {
    const { store, byId, insertSpy } = makeStore();
    const r = await createGenericDraft(store, okVerifier, validStep1);
    expect(r.kind).toBe("success");
    if (r.kind !== "success") return;
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const stored = insertSpy.mock.calls[0][0];
    expect(stored.source).toBe("generic");
    expect(stored.token_hash).toBe(hashIntakeToken(r.token)); // hash only
    expect(JSON.stringify(stored)).not.toContain(r.token); // raw token never stored
    expect(stored.columns.email).toBe("ada@acme.co.za"); // derived + lowercased
    const row = [...byId.values()][0];
    expect(row.status).toBe("draft");
    // Sanitized view: no token_hash / id / _prefill exposed.
    expect(r.view).not.toHaveProperty("token_hash");
    expect(JSON.stringify(r.view)).not.toContain("_prefill");
  });
});

describe("saveIntakeDraft — partial patch, no fresh Turnstile", () => {
  it("malformed / unknown token → invalid_or_closed", async () => {
    const { store } = makeStore();
    expect((await saveIntakeDraft(store, "bad", { location: "CT" })).kind).toBe("invalid_or_closed");
    expect((await saveIntakeDraft(store, "A".repeat(43), { location: "CT" })).kind).toBe("invalid_or_closed");
  });
  it("preserves unrelated answers and re-derives columns", async () => {
    const { row, rawToken, now } = seedDraft();
    const { store, byId } = makeStore([row]);
    const r = await saveIntakeDraft(store, rawToken, { investment_band: "Under R5,000", business_name: "Acme Renamed" }, now);
    expect(r.kind).toBe("success");
    const saved = byId.get("seed1")!;
    expect(saved.data.keywords).toEqual(["plumber"]); // untouched
    expect(saved.data.investment_band).toBe("Under R5,000");
    expect(saved.columns!.business_name).toBe("Acme Renamed"); // re-derived
  });
  it("a client patch cannot replace/inject _prefill", async () => {
    const { row, rawToken, now } = seedDraft();
    const { store, byId } = makeStore([row]);
    await saveIntakeDraft(store, rawToken, { _prefill: { email: "attacker@evil" }, email: "new@acme.co.za" }, now);
    expect((byId.get("seed1")!.data._prefill as Record<string, unknown>).email).toBe("admin@acme.co.za");
  });
  it("service deselection preserves stored service answers", async () => {
    const { row, rawToken, now } = seedDraft();
    const { store, byId } = makeStore([row]);
    await saveIntakeDraft(store, rawToken, { selected_services: ["website"] }, now);
    expect(byId.get("seed1")!.data.keywords).toEqual(["plumber"]); // kept
  });
  it("rejects an oversized payload", async () => {
    const { row, rawToken, now } = seedDraft();
    const { store } = makeStore([row]);
    const huge: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) huge["k" + i] = "x";
    expect((await saveIntakeDraft(store, rawToken, huge, now)).kind).toBe("validation_error");
  });
  it("cannot mutate a submitted or expired intake", async () => {
    const sub = seedDraft({ status: "submitted" });
    const { store: s1 } = makeStore([sub.row]);
    expect((await saveIntakeDraft(s1, sub.rawToken, { location: "CT" }, sub.now)).kind).toBe("already_submitted");

    const exp = seedDraft({ token_expires_at: "2020-01-01T00:00:00Z" });
    const { store: s2 } = makeStore([exp.row]);
    expect((await saveIntakeDraft(s2, exp.rawToken, { location: "CT" }, exp.now)).kind).toBe("expired");
  });
});

describe("submitIntake — Turnstile + atomic single notification", () => {
  it("honeypot / turnstile fail / unconfigured never submit or notify", async () => {
    const { row, rawToken, now } = seedDraft();
    const notify = vi.fn(async () => {});
    for (const [verifier, args, expected] of [
      [okVerifier, { rawToken, honeypot: "bot", turnstileToken: "t" }, "verification_failed"],
      [failVerifier, { rawToken, turnstileToken: "t" }, "verification_failed"],
      [unconfigured, { rawToken, turnstileToken: "t" }, "configuration_error"],
    ] as const) {
      const { store } = makeStore([{ ...row }]);
      const r = await submitIntake(store, verifier, args, notify, now);
      expect(r.kind).toBe(expected);
    }
    expect(notify).not.toHaveBeenCalled();
  });

  it("valid draft submits once, sets submitted_at, syncs columns, notifies once", async () => {
    const { row, rawToken, now } = seedDraft();
    const { store, byId } = makeStore([row]);
    const notify = vi.fn(async () => {});
    const r = await submitIntake(store, okVerifier, { rawToken, turnstileToken: "t" }, notify, now);
    expect(r.kind).toBe("success");
    const saved = byId.get("seed1")!;
    expect(saved.status).toBe("submitted");
    expect(saved.submitted_at).toBe(now.toISOString());
    expect(saved.columns!.business_name).toBe("Acme");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("rejects an incomplete submission (no email) with no transition/notify", async () => {
    const bad = seedDraft({ data: normalizeIntakeData({ contact_name: "Ada", business_name: "Acme", selected_services: ["seo"] }) as unknown as Record<string, unknown> });
    // remove email entirely
    delete (bad.row.data as Record<string, unknown>).email;
    const { store, byId } = makeStore([bad.row]);
    const notify = vi.fn(async () => {});
    const r = await submitIntake(store, okVerifier, { rawToken: bad.rawToken, turnstileToken: "t" }, notify, bad.now);
    expect(r.kind).toBe("validation_error");
    expect(byId.get("seed1")!.status).toBe("draft");
    expect(notify).not.toHaveBeenCalled();
  });

  it("concurrent double-submit notifies EXACTLY once (atomic claim)", async () => {
    // Store where both requests resolve a draft, but only the first claim wins.
    const { row, rawToken, now } = seedDraft();
    let claimed = false;
    const store: ProspectIntakeStore = {
      insertDraft: async () => ({ id: "x" }),
      findByTokenHash: async () => ({ id: row.id, status: "draft", source: "generic", token_expires_at: row.token_expires_at, data: row.data }),
      updateDraftData: async () => true,
      claimSubmit: async () => {
        if (claimed) return false;
        claimed = true;
        return true;
      },
    };
    const notify = vi.fn(async () => {});
    const [a, b] = await Promise.all([
      submitIntake(store, okVerifier, { rawToken, turnstileToken: "t" }, notify, now),
      submitIntake(store, okVerifier, { rawToken, turnstileToken: "t" }, notify, now),
    ]);
    expect(notify).toHaveBeenCalledTimes(1);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["already_submitted", "success"]);
  });

  it("notification failure does NOT revert a submission and is logged via the sink", async () => {
    const { row, rawToken, now } = seedDraft();
    const { store, byId } = makeStore([row]);
    const notify = vi.fn(async () => {
      throw new Error("notify down");
    });
    const onNotifyError = vi.fn();
    const r = await submitIntake(store, okVerifier, { rawToken, turnstileToken: "t" }, notify, now, onNotifyError);
    expect(r.kind).toBe("success"); // prospect still gets success
    expect(byId.get("seed1")!.status).toBe("submitted"); // stays submitted (no revert)
    expect(onNotifyError).toHaveBeenCalledTimes(1); // failure surfaced for server-side logging
  });

  it("does NOT invoke the notify-error sink when notification succeeds", async () => {
    const { row, rawToken, now } = seedDraft();
    const { store } = makeStore([row]);
    const onNotifyError = vi.fn();
    const r = await submitIntake(
      store, okVerifier, { rawToken, turnstileToken: "t" }, vi.fn(async () => {}), now, onNotifyError
    );
    expect(r.kind).toBe("success");
    expect(onNotifyError).not.toHaveBeenCalled();
  });
});

describe("resolveIntakeView — non-enumerating + sanitized", () => {
  it("ok draft and submitted return a view; expired/closed do not", async () => {
    const draft = seedDraft();
    const { store: s1 } = makeStore([draft.row]);
    const okv = await resolveIntakeView(s1, draft.rawToken, draft.now);
    expect(okv.kind).toBe("ok");
    expect(okv.view?.canMutate).toBe(true);
    expect(JSON.stringify(okv.view)).not.toContain("_prefill"); // reserved stripped
    expect(okv.view).not.toHaveProperty("token_hash");

    const conv = seedDraft({ status: "converted" });
    const { store: s2 } = makeStore([conv.row]);
    expect((await resolveIntakeView(s2, conv.rawToken, conv.now)).kind).toBe("invalid_or_closed");

    const { store: s3 } = makeStore();
    expect((await resolveIntakeView(s3, "totally-unknown-but-not-wellformed")).kind).toBe("invalid_or_closed");
  });

  it("HONEYPOT_FIELD is non-semantic (won't collide with real fields)", () => {
    expect(["email", "phone", "name", "url", "business_name"]).not.toContain(HONEYPOT_FIELD);
  });
});
