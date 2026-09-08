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
  type SubmitNotification,
} from "./intake-server";
import { issueIntakeToken, hashIntakeToken } from "./intake-token";
import { normalizeIntakeData, derivePromotedColumns } from "./intake-normalize";

// ── Fakes ────────────────────────────────────────────────────────────────────
// The fake store models the REAL store contract faithfully for the concurrency
// properties under test: (a) `updated_at` is an opaque version bumped on EVERY
// successful write (models the BEFORE UPDATE trigger); (b) updateDraftData is
// guarded WHERE status='draft'; (c) claimSubmit is a CAS on (status='draft' AND
// updated_at=expected) that writes NO data. So the version guard — not mocked
// call ordering — decides who wins.
interface Row extends StoredIntake {
  token_hash: string;
  columns?: PromotedColumns;
  submitted_at?: string;
}
function makeStore(seed: Row[] = []) {
  const byId = new Map<string, Row>();
  const byHash = new Map<string, string>();
  let seq = 0;
  let ver = 0;
  const nextVer = () => `v${++ver}`;
  const insertSpy = vi.fn();
  for (const r of seed) {
    byId.set(r.id, { ...r, updated_at: r.updated_at ?? nextVer() });
    byHash.set(r.token_hash, r.id);
  }
  const store: ProspectIntakeStore = {
    async insertDraft(input) {
      insertSpy(input);
      const id = `id${++seq}`;
      byId.set(id, {
        id, status: "draft", source: input.source, updated_at: nextVer(),
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
      return {
        id: r.id, status: r.status, source: r.source,
        token_expires_at: r.token_expires_at, updated_at: r.updated_at, data: r.data,
      };
    },
    async updateDraftData(id, data, columns) {
      const r = byId.get(id);
      if (!r || r.status !== "draft") return false; // atomic draft-only guard
      r.data = data; r.columns = columns; r.updated_at = nextVer(); // trigger bumps version
      return true;
    },
    async claimSubmit(id, expectedUpdatedAt, at) {
      const r = byId.get(id);
      if (!r || r.status !== "draft") return false; // already transitioned
      if (r.updated_at !== expectedUpdatedAt) return false; // CAS miss — a write landed
      r.status = "submitted"; r.submitted_at = at; r.updated_at = nextVer();
      return true; // claim writes NO data/columns — they stay as last saved
    },
  };
  return { store, byId, byHash, insertSpy, nextVer };
}
const okVerifier: TurnstileVerifier = { verify: async () => ({ ok: true, configured: true }) };
const failVerifier: TurnstileVerifier = { verify: async () => ({ ok: false, configured: true }) };
const unconfigured: TurnstileVerifier = { verify: async () => ({ ok: false, configured: false }) };

function seedDraft(overrides: Partial<Row> = {}, now = new Date("2026-01-01T00:00:00Z")) {
  const tok = issueIntakeToken(now);
  const { data: dataOverride, ...restOverrides } = overrides;
  // A submittable draft has already been saved, so its data + promoted columns
  // are in sync (columns are written alongside data by save/create — never by
  // the claim). updated_at is the seed version ("v0"); makeStore advances it.
  const data =
    (dataOverride as Record<string, unknown> | undefined) ??
    normalizeIntakeData({
      contact_name: "Ada", business_name: "Acme", email: "ada@acme.co.za",
      selected_services: ["seo"], keywords: ["plumber"],
      _prefill: { email: "admin@acme.co.za" },
    });
  const row: Row = {
    id: "seed1", status: "draft", source: "generic", updated_at: "v0",
    token_expires_at: tok.expiresAt, token_hash: tok.tokenHash,
    data, columns: derivePromotedColumns(data),
    ...restOverrides,
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

  it("valid draft submits once, sets submitted_at, preserves saved data+columns, notifies once", async () => {
    const { row, rawToken, now } = seedDraft();
    const { store, byId } = makeStore([row]);
    const notify = vi.fn(async () => {});
    const r = await submitIntake(store, okVerifier, { rawToken, turnstileToken: "t" }, notify, now);
    expect(r.kind).toBe("success");
    const saved = byId.get("seed1")!;
    expect(saved.status).toBe("submitted");
    expect(saved.submitted_at).toBe(now.toISOString());
    expect(saved.data.business_name).toBe("Acme"); // claim never rewrote data
    expect(saved.columns!.business_name).toBe("Acme"); // columns from the saved draft
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

  it("D. two concurrent submits → one transition, one notification, other gets already_submitted", async () => {
    // Both resolve draft/v1; only the first claim wins. After it wins, the row
    // reads `submitted`, so the loser's re-resolve returns already_submitted.
    const { row, rawToken, now } = seedDraft();
    let claimed = false;
    const store: ProspectIntakeStore = {
      insertDraft: async () => ({ id: "x" }),
      findByTokenHash: async () => ({
        id: row.id,
        status: claimed ? "submitted" : "draft",
        source: "generic",
        token_expires_at: row.token_expires_at,
        updated_at: "v1",
        data: row.data,
      }),
      updateDraftData: async () => true,
      claimSubmit: async () => {
        if (claimed) return false; // second claim sees the row already transitioned
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

describe("submitIntake — versioned CAS concurrency (adversarial interleavings)", () => {
  // Inject exactly ONE concurrent save between submit's first read and its claim
  // by wrapping findByTokenHash: capture the pre-save snapshot, mutate the row +
  // bump the version (models the trigger), return the STALE snapshot to submit.
  function injectOneSave(
    store: ProspectIntakeStore,
    byId: Map<string, Row>,
    mutate: (data: Record<string, unknown>) => Record<string, unknown>,
    version = "vSAVE"
  ) {
    const orig = store.findByTokenHash.bind(store);
    let done = false;
    store.findByTokenHash = async (h) => {
      const snap = await orig(h); // captures current data ref + updated_at (by value)
      if (!done) {
        done = true;
        const cur = byId.get("seed1")!;
        const next = mutate({ ...cur.data });
        cur.data = next;
        cur.columns = derivePromotedColumns(next);
        cur.updated_at = version; // a save landed → version moves
      }
      return snap;
    };
  }

  it("A. save wins between read and claim → CAS misses, submit re-validates and submits the NEW version (B preserved)", async () => {
    const { row, rawToken, now } = seedDraft();
    const { store, byId } = makeStore([row]);
    injectOneSave(store, byId, (d) =>
      normalizeIntakeData({ ...d, business_name: "Newer Co", investment_band: "Under R5,000" })
    );
    const notify = vi.fn(async (_n: SubmitNotification) => {});
    const r = await submitIntake(store, okVerifier, { rawToken, turnstileToken: "t" }, notify, now);
    expect(r.kind).toBe("success");
    const saved = byId.get("seed1")!;
    expect(saved.status).toBe("submitted");
    expect(saved.data.business_name).toBe("Newer Co"); // stale A never written back over B
    expect(saved.columns!.business_name).toBe("Newer Co");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].businessName).toBe("Newer Co"); // notified on the ACTUAL row
  });

  it("B. save invalidates the draft before claim → CAS misses, re-validation fails, no stale-valid submission", async () => {
    const { row, rawToken, now } = seedDraft();
    const { store, byId } = makeStore([row]);
    injectOneSave(store, byId, (d) => {
      const next = { ...d };
      delete next.email; // B fails validateForSubmit
      return next;
    });
    const notify = vi.fn(async () => {});
    const r = await submitIntake(store, okVerifier, { rawToken, turnstileToken: "t" }, notify, now);
    expect(r.kind).toBe("validation_error"); // evaluated against B, not stale-valid A
    expect(byId.get("seed1")!.status).toBe("draft"); // never transitioned
    expect(notify).not.toHaveBeenCalled();
  });

  it("C. once a submit has claimed, the store's atomic draft-only guard makes a later save a no-op", async () => {
    const { row, now } = seedDraft();
    const { store, byId } = makeStore([row]);
    // A submit won the claim (row left draft)...
    const claimed = await store.claimSubmit("seed1", byId.get("seed1")!.updated_at, now.toISOString());
    expect(claimed).toBe(true);
    expect(byId.get("seed1")!.status).toBe("submitted");
    // ...now a save whose pre-read saw `draft` executes its mutation. The guard
    // is AT the mutation boundary (WHERE status='draft'), not a stale pre-read.
    const wrote = await store.updateDraftData(
      "seed1",
      normalizeIntakeData({ business_name: "Hijack Co" }),
      derivePromotedColumns({ business_name: "Hijack Co" })
    );
    expect(wrote).toBe(false); // no-op
    expect(byId.get("seed1")!.data.business_name).toBe("Acme"); // submitted data untouched
  });

  it("C(service). a save after submit resolves already_submitted and never mutates the row", async () => {
    const { row, rawToken, now } = seedDraft();
    const { store, byId } = makeStore([row]);
    const notify = vi.fn(async () => {});
    expect((await submitIntake(store, okVerifier, { rawToken, turnstileToken: "t" }, notify, now)).kind).toBe("success");
    const before = JSON.stringify(byId.get("seed1")!.data);
    const late = await saveIntakeDraft(store, rawToken, { business_name: "Hijack Co" }, now);
    expect(late.kind).toBe("already_submitted");
    expect(JSON.stringify(byId.get("seed1")!.data)).toBe(before); // unchanged
  });

  it("E. sustained save contention exhausts the retry bound → conflict, row stays draft, no notification", async () => {
    const { row, rawToken, now } = seedDraft();
    const { store, byId } = makeStore([row]);
    // A save bumps the version before EVERY claim → CAS can never match.
    const orig = store.findByTokenHash.bind(store);
    let n = 0;
    store.findByTokenHash = async (h) => {
      const snap = await orig(h);
      byId.get("seed1")!.updated_at = `vSAVE${++n}`; // moves after we captured snap
      return snap; // stale version handed to submit
    };
    const notify = vi.fn(async () => {});
    const r = await submitIntake(store, okVerifier, { rawToken, turnstileToken: "t" }, notify, now);
    expect(r.kind).toBe("conflict"); // never submits an unvalidated version
    expect(byId.get("seed1")!.status).toBe("draft");
    expect(notify).not.toHaveBeenCalled();
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
