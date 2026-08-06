import { describe, it, expect } from "vitest";
import { legalActionsFor, TASK_ACTION_LABEL, type TaskActionKey } from "./task-legality";
import type { TaskStatus } from "@/lib/database.types";

const keys = (s: TaskStatus) => legalActionsFor(s).map((a) => a.key);

describe("legalActionsFor", () => {
  it("planned → Start, Schedule, Complete, Block, Drop, Delete", () => {
    expect(keys("planned")).toEqual(["start", "schedule", "complete", "block", "drop", "delete"]);
  });
  it("scheduled → Start, Reschedule, Unschedule, Complete, Block, Drop, Delete", () => {
    expect(keys("scheduled")).toEqual(["start", "reschedule", "unschedule", "complete", "block", "drop", "delete"]);
  });
  it("in_progress → Complete, Defer, Block, Drop, Delete", () => {
    expect(keys("in_progress")).toEqual(["complete", "defer", "block", "drop", "delete"]);
  });
  it("waiting → Unblock, Drop, Delete only (not actionable work)", () => {
    expect(keys("waiting")).toEqual(["unblock", "drop", "delete"]);
  });
  it("inbox/completed/archived expose NO My Tasks controls (erase not surfaced there)", () => {
    for (const s of ["inbox", "completed", "archived"] as TaskStatus[]) expect(legalActionsFor(s)).toEqual([]);
  });
  it("Delete is offered LAST on every active status and is the 'delete' kind", () => {
    for (const s of ["planned", "scheduled", "in_progress", "waiting"] as TaskStatus[]) {
      const actions = legalActionsFor(s);
      const last = actions[actions.length - 1];
      expect(last).toEqual({ key: "delete", kind: "delete" });
      // exactly one delete, never duplicated among the lifecycle actions
      expect(actions.filter((a) => a.key === "delete")).toHaveLength(1);
    }
  });
  it("schedule/reschedule are 'date' kind; block is 'block'; delete is 'delete'; the rest are 'instant'", () => {
    const kind = (s: TaskStatus, k: TaskActionKey) => legalActionsFor(s).find((a) => a.key === k)?.kind;
    expect(kind("planned", "schedule")).toBe("date");
    expect(kind("scheduled", "reschedule")).toBe("date");
    expect(kind("planned", "block")).toBe("block");
    expect(kind("planned", "delete")).toBe("delete");
    expect(kind("planned", "start")).toBe("instant");
    expect(kind("scheduled", "unschedule")).toBe("instant");
    expect(kind("in_progress", "defer")).toBe("instant");
    expect(kind("waiting", "unblock")).toBe("instant");
  });
  it("every legal action key has a human label", () => {
    for (const s of ["planned", "scheduled", "in_progress", "waiting"] as TaskStatus[])
      for (const a of legalActionsFor(s)) expect(TASK_ACTION_LABEL[a.key]).toBeTruthy();
    expect(TASK_ACTION_LABEL.delete).toBe("Delete");
  });
});
