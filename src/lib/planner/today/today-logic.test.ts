import { describe, it, expect } from "vitest";
import type { TaskView } from "@/lib/planner/tasks/task-view";
import type { MeetingStatus } from "@/lib/database.types";
import { groupToday, actionableToday } from "./today-grouping";
import { nextBestAction } from "./next-best-action";
import { todayProgress } from "./today-progress";
import { smartAlerts } from "./smart-alerts";
import type { TodayMeeting } from "./today-meeting";

function v(o: Partial<TaskView> & Pick<TaskView, "id" | "status">): TaskView {
  return {
    title: o.title ?? `${o.status}-${o.id}`, priority: "normal", criticalReason: null, description: null, scheduledDate: null,
    dueDate: null, estimatedMinutes: null, isOverdue: false, isWaiting: o.status === "waiting",
    blockedSince: null, ownerDisplay: null, assigneeDisplay: null, isCompleted: o.status === "completed",
    completedAt: null, isRecurring: false, recurrenceLabel: null, aggregateVersion: 1, ...o,
  };
}
const mtg = (o: Partial<TodayMeeting> & Pick<TodayMeeting, "id" | "startsAt" | "endsAt">): TodayMeeting => ({
  title: o.title ?? "Meeting", status: "confirmed" as MeetingStatus, hasMeet: true, ...o,
});
const NOW = new Date("2026-08-04T09:00:00Z"); // 11:00 SAST
const groupOf = (gs: ReturnType<typeof groupToday>, id: string) => gs.find((g) => g.tasks.some((t) => t.id === id))?.key;

describe("groupToday — single placement", () => {
  const active = [
    v({ id: "od", status: "scheduled", isOverdue: true, dueDate: "2026-08-01" }),
    v({ id: "ip", status: "in_progress", scheduledDate: "2026-08-04" }),
    v({ id: "pl", status: "planned", scheduledDate: "2026-08-04" }),
    v({ id: "wt", status: "waiting", scheduledDate: "2026-08-04" }),
  ];
  const done = [v({ id: "cd", status: "completed", completedAt: "2026-08-04T08:00:00Z" })];
  const gs = groupToday(active, done);
  it("orders Overdue → In Progress → Planned → Completed → Waiting", () => {
    expect(gs.map((g) => g.key)).toEqual(["overdue", "in_progress", "planned_today", "completed_today", "waiting"]);
  });
  it("overdue (non-waiting) appears only in Overdue", () => {
    expect(groupOf(gs, "od")).toBe("overdue");
    expect(gs.filter((g) => g.tasks.some((t) => t.id === "od"))).toHaveLength(1);
  });
  it("waiting stays in Waiting; each task placed exactly once", () => {
    expect(groupOf(gs, "wt")).toBe("waiting");
    expect(gs.reduce((n, g) => n + g.tasks.length, 0)).toBe(5);
  });
  it("actionableToday excludes waiting", () => {
    expect(actionableToday(active).map((t) => t.id)).toEqual(["od", "ip", "pl"]);
  });
});

describe("nextBestAction — deterministic", () => {
  it("recommends meeting-prep when the next meeting is within 30 min", () => {
    const nba = nextBestAction([v({ id: "a", status: "planned" })], [mtg({ id: "m1", startsAt: "2026-08-04T09:20:00Z", endsAt: "2026-08-04T10:00:00Z" })], NOW);
    expect(nba?.kind).toBe("meeting");
    if (nba?.kind === "meeting") expect(nba.meeting.id).toBe("m1");
  });
  it("otherwise picks overdue > priority; never a waiting task", () => {
    const nba = nextBestAction(actionableToday([
      v({ id: "wt", status: "waiting" }),
      v({ id: "hi", status: "planned", priority: "high" }),
      v({ id: "od", status: "planned", isOverdue: true, priority: "low", dueDate: "2026-08-01" }),
    ]), [], NOW);
    expect(nba?.kind).toBe("task");
    if (nba?.kind === "task") expect(nba.task.id).toBe("od"); // overdue outranks high priority
  });
  it("continues in-progress over planned at equal priority", () => {
    const nba = nextBestAction([v({ id: "pl", status: "planned" }), v({ id: "ip", status: "in_progress" })], [], NOW);
    if (nba?.kind === "task") expect(nba.task.id).toBe("ip");
  });
  it("null when there is nothing actionable and no imminent meeting", () => {
    expect(nextBestAction([], [], NOW)).toBeNull();
  });
});

describe("todayProgress — honest", () => {
  it("computes completion%, excludes meetings, counts missing estimates", () => {
    const remaining = [v({ id: "a", status: "planned", estimatedMinutes: 30 }), v({ id: "b", status: "in_progress" }), v({ id: "c", status: "planned", isOverdue: true, dueDate: "2026-08-01" })];
    const done = [v({ id: "d", status: "completed" }), v({ id: "e", status: "completed" })];
    const p = todayProgress(remaining, done, 2);
    expect(p).toMatchObject({ completed: 2, remaining: 3, overdue: 1, meetingsRemaining: 2, totalActionable: 5, completionPct: 40, estimatedRemainingMinutes: 30, remainingWithoutEstimate: 2 });
  });
  it("no tasks → 0% (never divides by zero)", () => {
    expect(todayProgress([], [], 0).completionPct).toBe(0);
  });
});

describe("smartAlerts — only genuine", () => {
  it("empty when nothing important", () => {
    expect(smartAlerts({ now: NOW, meetings: [], overdueCount: 0, dueTodayCount: 0, estimatedRemainingMinutes: 0 })).toEqual([]);
  });
  it("emits meeting-soon, overdue, due-today, and won't-fit", () => {
    const meetings = [mtg({ id: "m", startsAt: "2026-08-04T09:10:00Z", endsAt: "2026-08-04T09:40:00Z" })]; // 10 min out
    const a = smartAlerts({ now: NOW, meetings, overdueCount: 2, dueTodayCount: 1, estimatedRemainingMinutes: 120 });
    expect(a.map((x) => x.key)).toEqual(["meeting-soon", "overdue", "due-today", "wont-fit"]);
  });
  it("does NOT fabricate a newly-assigned alert", () => {
    const a = smartAlerts({ now: NOW, meetings: [], overdueCount: 1, dueTodayCount: 0, estimatedRemainingMinutes: 0 });
    expect(a.some((x) => x.key.includes("assign"))).toBe(false);
  });
});
