import { describe, it, expect, vi } from "vitest";
import { beginCommandIntent, clearCommandIntent, commandIntentAfterResult, intentDispositionFor, prepareCommandSubmit, IDLE, type CommandIntent } from "./inbox-command-intent";
import type { TaskActionResult } from "./action-result";

function minter() {
  let n = 0;
  return { mint: vi.fn(() => `K${++n}`) };
}
const TRIAGE_SIG = ""; // triage has no variable payload → a constant signature

describe("inbox-command-intent — begin", () => {
  it("Idle → Draft mints exactly one key (not yet attempted)", () => {
    const { mint } = minter();
    expect(beginCommandIntent(IDLE, mint)).toEqual({ key: "K1", attemptedSignature: null });
    expect(mint).toHaveBeenCalledTimes(1);
  });
  it("Draft → same Draft never re-mints", () => {
    const { mint } = minter();
    const d: CommandIntent = { key: "K1", attemptedSignature: null };
    expect(beginCommandIntent(d, mint)).toBe(d);
    expect(mint).not.toHaveBeenCalled();
  });
});

describe("inbox-command-intent — Triage (constant signature)", () => {
  it("first submit + same-signature retries reuse ONE key", () => {
    const { mint } = minter();
    let intent: CommandIntent = beginCommandIntent(IDLE, mint);
    const a = prepareCommandSubmit(intent, TRIAGE_SIG, mint); intent = a;
    intent = commandIntentAfterResult(intent, "retain"); // failed
    const b = prepareCommandSubmit(intent, TRIAGE_SIG, mint); // retry
    expect(a.key).toBe("K1");
    expect(b.key).toBe("K1");
    expect(mint).toHaveBeenCalledTimes(1);
  });
});

describe("inbox-command-intent — Schedule (date signature)", () => {
  it("same-date retry reuses the key", () => {
    const { mint } = minter();
    let intent: CommandIntent = beginCommandIntent(IDLE, mint);
    intent = prepareCommandSubmit(intent, "2026-08-10", mint);
    intent = commandIntentAfterResult(intent, "retain");
    const retry = prepareCommandSubmit(intent, "2026-08-10", mint);
    expect(retry.key).toBe("K1");
    expect(mint).toHaveBeenCalledTimes(1);
  });
  it("changing the date AFTER a submission attempt mints a NEW key", () => {
    const { mint } = minter();
    let intent: CommandIntent = beginCommandIntent(IDLE, mint);
    intent = prepareCommandSubmit(intent, "2026-08-10", mint); // attempt K1
    intent = commandIntentAfterResult(intent, "retain"); // uncertain/failed
    const edited = prepareCommandSubmit(intent, "2026-08-11", mint); // date changed
    expect(edited.key).toBe("K2");
    expect(edited.attemptedSignature).toBe("2026-08-11");
    expect(mint).toHaveBeenCalledTimes(2);
  });
  it("never reuses one key across two different submitted dates", () => {
    const { mint } = minter();
    let intent: CommandIntent = beginCommandIntent(IDLE, mint);
    const a = prepareCommandSubmit(intent, "2026-08-10", mint); intent = a;
    intent = commandIntentAfterResult(intent, "retain");
    const b = prepareCommandSubmit(intent, "2026-08-20", mint);
    expect(a.key).not.toBe(b.key);
  });
});

describe("inbox-command-intent — Triage and Schedule keep SEPARATE keys", () => {
  it("two independent intents never share a key", () => {
    const { mint } = minter();
    let triage: CommandIntent = beginCommandIntent(IDLE, mint); // K1
    let schedule: CommandIntent = beginCommandIntent(IDLE, mint); // K2
    const t = prepareCommandSubmit(triage, TRIAGE_SIG, mint);
    const s = prepareCommandSubmit(schedule, "2026-08-10", mint);
    triage = t; schedule = s;
    expect(t.key).toBe("K1");
    expect(s.key).toBe("K2");
    expect(t.key).not.toBe(s.key);
  });
});

describe("inbox-command-intent — terminal transitions", () => {
  it("clear disposition → Idle; retain → same", () => {
    const intent: CommandIntent = { key: "K1", attemptedSignature: "x" };
    expect(commandIntentAfterResult(intent, "clear")).toBe(IDLE);
    expect(commandIntentAfterResult(intent, "retain")).toBe(intent);
  });
  it("clearCommandIntent → Idle", () => {
    expect(clearCommandIntent()).toBe(IDLE);
  });
});

describe("inbox-command-intent — intentDispositionFor", () => {
  const ok: TaskActionResult = { ok: true, outcome: "applied", taskId: "t1", aggregateVersion: 2 };
  it("any success outcome → clear", () => {
    for (const outcome of ["applied", "accepted_noop", "replayed"] as const) {
      expect(intentDispositionFor({ ...ok, outcome })).toBe("clear");
    }
  });
  it("VersionConflict → clear (task moved on)", () => {
    expect(intentDispositionFor({ ok: false, code: "VersionConflict", error: "x" })).toBe("clear");
  });
  it("retryable failures → retain", () => {
    for (const code of ["IdempotencyConflict", "PersistenceError", "InvalidCommand", "TasksDisabled", "NotAuthenticated", "NoWorkspace"] as const) {
      expect(intentDispositionFor({ ok: false, code, error: "x" })).toBe("retain");
    }
  });
});
