import { describe, it, expect, vi } from "vitest";
import { beginIntent, clearIntent, intentAfterResult, prepareSubmit, validateDraft, IDLE, type CaptureIntent } from "./quick-capture-intent";

// A deterministic key minter that yields K1, K2, K3… and counts mints.
function minter() {
  let n = 0;
  const mint = vi.fn(() => `K${++n}`);
  return { mint };
}

describe("quick-capture-intent — begin / edit before first submit", () => {
  it("first interaction mints exactly one key (attempt not yet made)", () => {
    const { mint } = minter();
    expect(beginIntent(IDLE, mint)).toEqual({ key: "K1", attemptedTitle: null });
    expect(mint).toHaveBeenCalledTimes(1);
  });
  it("editing BEFORE the first submit keeps the same key", () => {
    const { mint } = minter();
    let intent = beginIntent(IDLE, mint); // types "Call"
    intent = beginIntent(intent, mint); // edits to "Call supplier" (no submit yet)
    expect(intent).toEqual({ key: "K1", attemptedTitle: null });
    expect(mint).toHaveBeenCalledTimes(1);
  });
});

describe("quick-capture-intent — submit / retry / edit-after-attempt", () => {
  it("first submit records the attempted title and keeps the key", () => {
    const { mint } = minter();
    const intent = beginIntent(IDLE, mint);
    const sub = prepareSubmit(intent, "Call supplier", mint);
    expect(sub).toEqual({ key: "K1", attemptedTitle: "Call supplier" });
    expect(mint).toHaveBeenCalledTimes(1); // no new mint on first submit
  });
  it("same-title retry after an error REUSES the key (safe replay)", () => {
    const { mint } = minter();
    let intent: CaptureIntent = beginIntent(IDLE, mint);
    intent = prepareSubmit(intent, "Call supplier", mint); // attempt 1
    intent = intentAfterResult(intent, false); // failed → keep
    const retry = prepareSubmit(intent, "Call supplier", mint); // same title
    expect(retry.key).toBe("K1");
    expect(mint).toHaveBeenCalledTimes(1);
  });
  it("UNCERTAIN-RESPONSE: editing the title after a submission attempt MINTS A NEW KEY", () => {
    // The exact bug: attempt "Call supplier" (may have committed), edit to
    // "Call supplier tomorrow", retry → must NOT reuse the key (would conflict).
    const { mint } = minter();
    let intent: CaptureIntent = beginIntent(IDLE, mint);
    intent = prepareSubmit(intent, "Call supplier", mint); // attempt with K1
    intent = intentAfterResult(intent, false); // response uncertain/lost → keep
    const edited = prepareSubmit(intent, "Call supplier tomorrow", mint); // changed payload
    expect(edited.key).toBe("K2"); // NEW key — never reuse one key with two payloads
    expect(edited.attemptedTitle).toBe("Call supplier tomorrow");
    expect(mint).toHaveBeenCalledTimes(2);
  });
  it("a whitespace-only edit after an attempt does NOT mint a new key (trimmed compare)", () => {
    const { mint } = minter();
    let intent: CaptureIntent = beginIntent(IDLE, mint);
    intent = prepareSubmit(intent, "Call supplier", mint); // stored trimmed
    intent = intentAfterResult(intent, false);
    const retry = prepareSubmit(intent, "Call supplier", mint); // caller already trimmed
    expect(retry.key).toBe("K1");
    expect(mint).toHaveBeenCalledTimes(1);
  });
  it("never reuses one key across two different submitted payloads", () => {
    const { mint } = minter();
    let intent: CaptureIntent = beginIntent(IDLE, mint);
    const a = prepareSubmit(intent, "A", mint); intent = { key: a.key, attemptedTitle: a.attemptedTitle };
    intent = intentAfterResult(intent, false);
    const b = prepareSubmit(intent, "B", mint);
    expect(a.key).not.toBe(b.key);
  });
});

describe("quick-capture-intent — terminal transitions", () => {
  it("all three success outcomes clear the intent (ok=true → Idle)", () => {
    const intent: CaptureIntent = { key: "K1", attemptedTitle: "x" };
    expect(intentAfterResult(intent, true)).toBe(IDLE); // applied/accepted_noop/replayed all pass ok:true
  });
  it("failure keeps the same Draft (key + attemptedTitle)", () => {
    const intent: CaptureIntent = { key: "K1", attemptedTitle: "x" };
    expect(intentAfterResult(intent, false)).toBe(intent);
  });
  it("Escape clears the intent → Idle", () => {
    expect(clearIntent()).toBe(IDLE);
  });
  it("after success, a brand-new capture mints a fresh key", () => {
    const { mint } = minter();
    let intent: CaptureIntent = { key: "K1", attemptedTitle: "old" };
    intent = intentAfterResult(intent, true); // success → Idle
    intent = beginIntent(intent, mint); // new capture
    expect(intent).toEqual({ key: "K1", attemptedTitle: null }); // first mint from this minter
  });
});

describe("quick-capture-intent — validateDraft", () => {
  it("trims and accepts a non-empty title", () => {
    expect(validateDraft("  Call supplier  ")).toEqual({ ok: true, title: "Call supplier" });
  });
  it("rejects empty / whitespace-only", () => {
    expect(validateDraft("")).toEqual({ ok: false });
    expect(validateDraft("   ")).toEqual({ ok: false });
    expect(validateDraft("\t\n ")).toEqual({ ok: false });
  });
});
