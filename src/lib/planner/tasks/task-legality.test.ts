import { describe, it, expect } from "vitest";
import { legalActionsFor, TASK_ACTION_LABEL, type TaskActionKey } from "./task-legality";
import type { TaskStatus } from "@/lib/database.types";

const keys = (s: TaskStatus) => legalActionsFor(s).map((a) => a.key);

describe("legalActionsFor", () => {
  it("planned → Start, Schedule, Complete, Block, Drop", () => {
    expect(keys("planned")).toEqual(["start", "schedule", "complete", "block", "drop"]);
  });
  it("scheduled → Start, Reschedule, Unschedule, Complete, Block, Drop", () => {
    expect(keys("scheduled")).toEqual(["start", "reschedule", "unschedule", "complete", "block", "drop"]);
  });
  it("in_progress → Complete, Defer, Block, Drop", () => {
    expect(keys("in_progress")).toEqual(["complete", "defer", "block", "drop"]);
  });
  it("waiting → Unblock, Drop only (not actionable)", () => {
    expect(keys("waiting")).toEqual(["unblock", "drop"]);
  });
  it("inbox/completed/archived expose NO My Tasks controls", () => {
    for (const s of ["inbox", "completed", "archived"] as TaskStatus[]) expect(legalActionsFor(s)).toEqual([]);
  });
  it("schedule/reschedule are 'date' kind; block is 'block'; the rest are 'instant'", () => {
    const kind = (s: TaskStatus, k: TaskActionKey) => legalActionsFor(s).find((a) => a.key === k)?.kind;
    expect(kind("planned", "schedule")).toBe("date");
    expect(kind("scheduled", "reschedule")).toBe("date");
    expect(kind("planned", "block")).toBe("block");
    expect(kind("planned", "start")).toBe("instant");
    expect(kind("scheduled", "unschedule")).toBe("instant");
    expect(kind("in_progress", "defer")).toBe("instant");
    expect(kind("waiting", "unblock")).toBe("instant");
  });
  it("every legal action key has a human label", () => {
    for (const s of ["planned", "scheduled", "in_progress", "waiting"] as TaskStatus[])
      for (const a of legalActionsFor(s)) expect(TASK_ACTION_LABEL[a.key]).toBeTruthy();
  });
});
