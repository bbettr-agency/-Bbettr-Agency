import { describe, it, expect } from "vitest";
import { groupWeek, weekDates } from "./week-grouping";
import type { TaskView } from "@/lib/planner/tasks/task-view";
import type { TaskPriority, TaskStatus } from "@/lib/database.types";

const WEEK_START = "2026-08-03"; // Monday
const WEEK_END = "2026-08-09"; // Sunday

let seq = 0;
function view(o: Partial<TaskView> = {}): TaskView {
  seq += 1;
  return {
    id: o.id ?? `t${seq}`,
    title: o.title ?? "Task",
    status: (o.status ?? "scheduled") as TaskStatus,
    priority: (o.priority ?? "normal") as TaskPriority,
    criticalReason: null,
    scheduledDate: o.scheduledDate ?? null,
    dueDate: o.dueDate ?? null,
    estimatedMinutes: null,
    isOverdue: o.isOverdue ?? false,
    isWaiting: o.isWaiting ?? false,
    blockedSince: null,
    ownerDisplay: null,
    assigneeDisplay: null,
    isCompleted: false,
    completedAt: null,
    aggregateVersion: 1,
  };
}

describe("weekDates", () => {
  it("returns the seven Mon→Sun dates of the week", () => {
    expect(weekDates(WEEK_START)).toEqual([
      "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09",
    ]);
  });
  it("rolls across a month boundary correctly", () => {
    expect(weekDates("2026-08-31")).toEqual([
      "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06",
    ]);
  });
});

describe("groupWeek", () => {
  it("always returns exactly 7 day buckets, Mon→Sun", () => {
    const g = groupWeek([], WEEK_START);
    expect(g.days.map((d) => d.date)).toEqual(weekDates(WEEK_START));
    expect(g.overdue).toEqual([]);
  });

  it("places a non-overdue task in its scheduled day only", () => {
    const g = groupWeek([view({ id: "wed", scheduledDate: "2026-08-05" })], WEEK_START);
    expect(g.days.find((d) => d.date === "2026-08-05")!.tasks.map((t) => t.id)).toEqual(["wed"]);
    expect(g.overdue).toEqual([]);
  });

  it("puts an overdue task in the callout ONLY — never also in its scheduled day", () => {
    // scheduled Wednesday but overdue (due last Monday) → Overdue, not Wednesday.
    const g = groupWeek([view({ id: "late", scheduledDate: "2026-08-05", dueDate: "2026-07-27", isOverdue: true })], WEEK_START);
    expect(g.overdue.map((t) => t.id)).toEqual(["late"]);
    expect(g.days.find((d) => d.date === "2026-08-05")!.tasks).toEqual([]);
  });

  it("every task appears exactly once across overdue + the 7 days (no duplication, no loss)", () => {
    const views = [
      view({ id: "od", isOverdue: true, dueDate: "2026-08-01" }),
      view({ id: "mon", scheduledDate: WEEK_START }),
      view({ id: "sun", scheduledDate: WEEK_END }),
      view({ id: "wed", scheduledDate: "2026-08-05" }),
    ];
    const g = groupWeek(views, WEEK_START);
    const placed = [...g.overdue, ...g.days.flatMap((d) => d.tasks)].map((t) => t.id).sort();
    expect(placed).toEqual(["mon", "od", "sun", "wed"]);
  });

  it("orders tasks within a day by priority then title (deterministic)", () => {
    const g = groupWeek(
      [
        view({ id: "b", scheduledDate: "2026-08-05", priority: "normal", title: "Bravo" }),
        view({ id: "a", scheduledDate: "2026-08-05", priority: "critical", title: "Zulu" }),
        view({ id: "c", scheduledDate: "2026-08-05", priority: "normal", title: "Alpha" }),
      ],
      WEEK_START
    );
    expect(g.days.find((d) => d.date === "2026-08-05")!.tasks.map((t) => t.id)).toEqual(["a", "c", "b"]);
  });

  it("does not place a non-overdue task scheduled outside the week", () => {
    const g = groupWeek([view({ id: "next", scheduledDate: "2026-08-20" })], WEEK_START);
    expect(g.days.flatMap((d) => d.tasks)).toEqual([]);
    expect(g.overdue).toEqual([]);
  });
});
