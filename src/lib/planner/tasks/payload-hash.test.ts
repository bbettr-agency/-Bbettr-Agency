import { describe, it, expect } from "vitest";
import { canonicalCommandHash } from "./payload-hash";
import type { TaskCommand } from "./state-machine";

describe("payload-hash — canonicalCommandHash", () => {
  it("is deterministic for the same command", () => {
    const c: TaskCommand = { type: "RenameTask", title: "Alpha" };
    expect(canonicalCommandHash(c)).toBe(canonicalCommandHash(c));
    expect(canonicalCommandHash(c)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("is stable regardless of object key order", () => {
    const a = { type: "TriageAndScheduleTask", owner_user_id: "o", scheduled_date: "2026-08-10", assignee_id: null } as TaskCommand;
    const b = { assignee_id: null, scheduled_date: "2026-08-10", type: "TriageAndScheduleTask", owner_user_id: "o" } as unknown as TaskCommand;
    expect(canonicalCommandHash(a)).toBe(canonicalCommandHash(b));
  });
  it("changes when command content changes", () => {
    expect(canonicalCommandHash({ type: "RenameTask", title: "Alpha" })).not.toBe(canonicalCommandHash({ type: "RenameTask", title: "Beta" }));
  });
  it("distinguishes different command types", () => {
    expect(canonicalCommandHash({ type: "CompleteTask" })).not.toBe(canonicalCommandHash({ type: "ReopenTask" }));
  });
  it("treats an undefined optional as absent (no throw, stable)", () => {
    const withUndef = { type: "TriageTask", owner_user_id: "o", priority: undefined } as unknown as TaskCommand;
    expect(canonicalCommandHash(withUndef)).toBe(canonicalCommandHash({ type: "TriageTask", owner_user_id: "o" }));
  });
});
