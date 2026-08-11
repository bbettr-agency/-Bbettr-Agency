import { describe, it, expect } from "vitest";
import { groupMyTasks } from "./my-tasks-grouping";
import type { TaskView } from "./task-view";

function v(overrides: Partial<TaskView> = {}): TaskView {
  return {
    id: "t", title: "T", status: "planned", priority: "normal", criticalReason: null,
    scheduledDate: null, dueDate: null, estimatedMinutes: null, isOverdue: false, isWaiting: false,
    blockedSince: null, ownerDisplay: null, assigneeDisplay: null, isCompleted: false, completedAt: null, isRecurring: false, recurrenceLabel: null, aggregateVersion: 1, ...overrides,
  };
}
const groupOf = (groups: ReturnType<typeof groupMyTasks>, id: string) => groups.find((g) => g.tasks.some((t) => t.id === id))?.key;

describe("groupMyTasks — single placement", () => {
  it("places each status in its own group, ordered Overdue→InProgress→Scheduled→Planned→Waiting", () => {
    const groups = groupMyTasks([
      v({ id: "p", status: "planned" }),
      v({ id: "s", status: "scheduled" }),
      v({ id: "ip", status: "in_progress" }),
      v({ id: "w", status: "waiting" }),
      v({ id: "od", status: "planned", isOverdue: true, dueDate: "2026-08-01" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["overdue", "in_progress", "scheduled", "planned", "waiting"]);
    expect(groupOf(groups, "od")).toBe("overdue");
    expect(groupOf(groups, "ip")).toBe("in_progress");
    expect(groupOf(groups, "w")).toBe("waiting");
  });
  it("an overdue non-waiting task appears ONLY in Overdue (not its base status)", () => {
    const groups = groupMyTasks([v({ id: "od", status: "scheduled", isOverdue: true })]);
    const appearances = groups.filter((g) => g.tasks.some((t) => t.id === "od"));
    expect(appearances).toHaveLength(1);
    expect(appearances[0].key).toBe("overdue");
    expect(groups.find((g) => g.key === "scheduled")).toBeUndefined();
  });
  it("a waiting task stays in Waiting even when overdue (never actionable), no duplication", () => {
    const groups = groupMyTasks([v({ id: "wo", status: "waiting", isOverdue: true, dueDate: "2026-08-01" })]);
    expect(groups.map((g) => g.key)).toEqual(["waiting"]);
    expect(groupOf(groups, "wo")).toBe("waiting");
  });
  it("no task is ever placed in more than one group", () => {
    const views = [v({ id: "a", status: "in_progress", isOverdue: true }), v({ id: "b", status: "planned" }), v({ id: "c", status: "waiting" })];
    const groups = groupMyTasks(views);
    const total = groups.reduce((n, g) => n + g.tasks.length, 0);
    expect(total).toBe(views.length);
  });
  it("excludes inbox/completed/archived entirely", () => {
    const groups = groupMyTasks([v({ id: "x", status: "completed" }), v({ id: "y", status: "archived" }), v({ id: "z", status: "inbox" })]);
    expect(groups).toEqual([]);
  });
  it("drops empty groups", () => {
    const groups = groupMyTasks([v({ id: "p", status: "planned" })]);
    expect(groups.map((g) => g.key)).toEqual(["planned"]);
  });
  it("sorts within a group by priority, then due date, then scheduled date, then title", () => {
    const groups = groupMyTasks([
      v({ id: "low", status: "planned", priority: "low" }),
      v({ id: "crit", status: "planned", priority: "critical" }),
      v({ id: "high", status: "planned", priority: "high" }),
    ]);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["crit", "high", "low"]);
  });
});
