import { describe, it, expect } from "vitest";
import { TaskError, isTaskError, mapDbError } from "./errors";

describe("errors — mapDbError", () => {
  const cases: [string, string][] = [
    ["BB460", "VersionConflict"],
    ["BB461", "IdempotencyConflict"],
    ["BB462", "EventContractViolation"],
    ["BB463", "TaskNotFound"],
    ["BB465", "ArchivedLabel"],
    ["BB471", "NotAuthenticated"],
    ["BB472", "NotAuthorized"],
    ["BB473", "NoWorkspace"],
    ["BB371", "IllegalTransition"],
    ["BB372", "ActiveChildren"],
    ["BB390", "DependencyCycle"],
    ["23503", "CrossWorkspaceReference"],
    ["23505", "IdempotencyConflict"],
  ];
  for (const [sqlstate, code] of cases) {
    it(`${sqlstate} → ${code}`, () => {
      expect(mapDbError({ code: sqlstate, message: "raw db text" }).code).toBe(code);
    });
  }
  it("unknown SQLSTATE → PersistenceError", () => {
    expect(mapDbError({ code: "23514", message: "check_violation ..." }).code).toBe("PersistenceError");
    expect(mapDbError({ code: "BB999" }).code).toBe("PersistenceError");
    expect(mapDbError(new Error("boom")).code).toBe("PersistenceError");
    expect(mapDbError("weird").code).toBe("PersistenceError");
  });
  it("never leaks the raw database message", () => {
    const err = mapDbError({ code: "BB460", message: "VersionConflict: expected 5 but task is at 6; secret=abc" });
    expect(err.message).not.toContain("secret");
    expect(err.message).not.toContain("task is at 6");
  });
  it("a TaskError passes through unchanged", () => {
    const original = new TaskError("NoWorkspace");
    expect(mapDbError(original)).toBe(original);
  });
  it("isTaskError / instanceof works", () => {
    const e = new TaskError("InvalidCommand");
    expect(isTaskError(e)).toBe(true);
    expect(e).toBeInstanceOf(TaskError);
    expect(isTaskError(new Error("x"))).toBe(false);
  });
});
