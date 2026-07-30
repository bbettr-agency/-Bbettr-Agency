import { describe, it, expect, afterEach } from "vitest";
import { isPlannerEnabled } from "./flags";

const original = process.env.PLANNER_ENABLED;
afterEach(() => {
  if (original === undefined) delete process.env.PLANNER_ENABLED;
  else process.env.PLANNER_ENABLED = original;
});

describe("isPlannerEnabled", () => {
  it("reads process.env at CALL time, not once at import (the root-cause fix)", () => {
    process.env.PLANNER_ENABLED = "true";
    expect(isPlannerEnabled()).toBe(true);
    // Same module import, env toggled → result changes. A module-level const
    // would have frozen the first value; a function re-reads each call.
    process.env.PLANNER_ENABLED = "false";
    expect(isPlannerEnabled()).toBe(false);
    process.env.PLANNER_ENABLED = "true";
    expect(isPlannerEnabled()).toBe(true);
  });

  it("is off unless the value is exactly \"true\"", () => {
    delete process.env.PLANNER_ENABLED;
    expect(isPlannerEnabled()).toBe(false);
    process.env.PLANNER_ENABLED = "TRUE";
    expect(isPlannerEnabled()).toBe(false);
    process.env.PLANNER_ENABLED = "1";
    expect(isPlannerEnabled()).toBe(false);
    process.env.PLANNER_ENABLED = "";
    expect(isPlannerEnabled()).toBe(false);
  });
});
