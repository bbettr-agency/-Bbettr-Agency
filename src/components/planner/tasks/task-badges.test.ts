import { describe, it, expect } from "vitest";
import { TASK_STATUS_BADGE, TASK_PRIORITY_BADGE } from "./task-badge-config";
import type { TaskPriority, TaskStatus } from "@/lib/database.types";

const TONES = ["brand", "neutral", "success", "warning", "danger", "info"];
const ALL_STATUSES: TaskStatus[] = ["inbox", "planned", "scheduled", "in_progress", "waiting", "completed", "archived"];
const ALL_PRIORITIES: TaskPriority[] = ["critical", "high", "normal", "low"];

describe("task-status-badge", () => {
  it("covers all seven statuses", () => {
    expect(Object.keys(TASK_STATUS_BADGE).sort()).toEqual([...ALL_STATUSES].sort());
  });
  it("every status has a non-empty text label (meaning is never colour-only)", () => {
    for (const s of ALL_STATUSES) {
      expect(TASK_STATUS_BADGE[s].label.trim().length).toBeGreaterThan(0);
    }
  });
  it("every status uses an existing Portal Badge tone", () => {
    for (const s of ALL_STATUSES) expect(TONES).toContain(TASK_STATUS_BADGE[s].tone);
  });
  it("labels are human-readable (In Progress, not in_progress)", () => {
    expect(TASK_STATUS_BADGE.in_progress.label).toBe("In Progress");
    expect(TASK_STATUS_BADGE.waiting.label).toBe("Waiting");
  });
});

describe("task-priority-badge", () => {
  it("covers all four priorities", () => {
    expect(Object.keys(TASK_PRIORITY_BADGE).sort()).toEqual([...ALL_PRIORITIES].sort());
  });
  it("every priority has a non-empty text label", () => {
    for (const p of ALL_PRIORITIES) expect(TASK_PRIORITY_BADGE[p].label.trim().length).toBeGreaterThan(0);
  });
  it("every priority uses an existing Portal Badge tone", () => {
    for (const p of ALL_PRIORITIES) expect(TONES).toContain(TASK_PRIORITY_BADGE[p].tone);
  });
});
