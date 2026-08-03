import { describe, it, expect, vi } from "vitest";
import { beginIntent, clearIntent, intentAfterResult, validateDraft, IDLE, type CaptureIntent } from "./quick-capture-intent";

describe("quick-capture-intent — session-scoped key", () => {
  it("Idle → Draft mints exactly one key", () => {
    const mint = vi.fn(() => "K1");
    const draft = beginIntent(IDLE, mint);
    expect(draft).toEqual({ key: "K1" });
    expect(mint).toHaveBeenCalledTimes(1);
  });
  it("Draft → same Draft never re-mints (edit/retry keeps the key)", () => {
    const mint = vi.fn(() => "SHOULD-NOT-MINT");
    const draft: CaptureIntent = { key: "K1" };
    expect(beginIntent(draft, mint)).toBe(draft);
    expect(mint).not.toHaveBeenCalled();
  });
  it("editing the draft after an error keeps the SAME key (intent, not text)", () => {
    let intent = beginIntent(IDLE, () => "K1"); // "Call supplier"
    intent = intentAfterResult(intent, false); // network fails → keep
    // user edits to "Call supplier tomorrow" and retries → same session
    intent = beginIntent(intent, () => "NEW-KEY-MUST-NOT-APPEAR");
    expect(intent).toEqual({ key: "K1" });
  });
  it("success (any outcome) destroys the key → Idle; the next capture mints fresh", () => {
    const intent = beginIntent(IDLE, () => "K1");
    const afterSuccess = intentAfterResult(intent, true);
    expect(afterSuccess).toBe(IDLE);
    const next = beginIntent(afterSuccess, () => "K2");
    expect(next).toEqual({ key: "K2" });
  });
  it("failure keeps the same key", () => {
    const intent: CaptureIntent = { key: "K1" };
    expect(intentAfterResult(intent, false)).toBe(intent);
  });
  it("Escape (cancel) destroys the key → Idle", () => {
    expect(clearIntent()).toBe(IDLE);
  });
  it("full lifecycle: begin → edit → retry(fail) → edit → success → new intent", () => {
    const mint = vi.fn().mockReturnValueOnce("K1").mockReturnValueOnce("K2");
    let intent = beginIntent(IDLE, mint); // begin
    intent = beginIntent(intent, mint); // edit (same key)
    intent = intentAfterResult(intent, false); // retry fails (keep)
    intent = beginIntent(intent, mint); // edit again (same key)
    expect(intent).toEqual({ key: "K1" });
    intent = intentAfterResult(intent, true); // success
    expect(intent).toBe(IDLE);
    intent = beginIntent(intent, mint); // brand-new capture
    expect(intent).toEqual({ key: "K2" });
    expect(mint).toHaveBeenCalledTimes(2); // only the two genuine session starts minted
  });
});

describe("quick-capture-intent — validateDraft", () => {
  it("trims and accepts a non-empty title", () => {
    expect(validateDraft("  Call supplier  ")).toEqual({ ok: true, title: "Call supplier" });
  });
  it("rejects empty / whitespace-only", () => {
    expect(validateDraft("")).toEqual({ ok: false });
    expect(validateDraft("    ")).toEqual({ ok: false });
    expect(validateDraft("\t\n ")).toEqual({ ok: false });
  });
});
