import { describe, it, expect } from "vitest";
import { buildTodaySummary, summariseTodayTaskViews } from "./today-summary";
import type { TaskView } from "@/lib/planner/tasks/task-view";
import type { TaskStatus } from "@/lib/database.types";

/**
 * FACTUAL RECONCILIATION — Planner Today vs Jarvis must agree.
 *
 * Both the dashboard and Jarvis derive Today counts from `summariseTodayTaskViews`
 * (and `buildTodaySummary`). These tests feed fixtures through that ONE shared logic and
 * assert the counts/titles. Expected numbers are DERIVED from the fixtures (array sizes),
 * not hardcoded — they just happen to reproduce the observed 12-Oct-2026 Production
 * values (12 total / 7 completed / 5 remaining / 0 overdue) for the same shape of data.
 */

const TODAY = "2026-10-12";

function view(over: Partial<TaskView> & Pick<TaskView, "id" | "title">): TaskView {
  return {
    status: "scheduled" as TaskStatus,
    priority: "normal",
    criticalReason: null,
    description: null,
    scheduledDate: null,
    dueDate: null,
    estimatedMinutes: null,
    isOverdue: false,
    isWaiting: false,
    blockedSince: null,
    ownerDisplay: null,
    assigneeDisplay: null,
    isCompleted: false,
    completedAt: null,
    isRecurring: false,
    recurrenceLabel: null,
    aggregateVersion: 1,
    isProjected: false,
    recurrenceDefinitionId: null,
    occurrenceSlot: null,
    ...over,
  };
}

// The five REMAINING tasks observed in Production (mix of scheduled-today-without-due,
// and plain scheduled-today), plus a would-be client vs personal split — none overdue.
const REMAINING: TaskView[] = [
  view({ id: "t1", title: "Cuisine Foods website finish before thu", scheduledDate: TODAY, dueDate: null }), // scheduled today, NO due date (the bug case)
  view({ id: "t2", title: "Finish Bos Outdoor website when i have time", scheduledDate: TODAY, dueDate: null }),
  view({ id: "t3", title: "Jan frits bel", scheduledDate: TODAY, dueDate: null }), // personal (no client), scheduled today
  view({ id: "t4", title: "jarvis Tackle when i have time", scheduledDate: TODAY, dueDate: null }),
  view({ id: "t5", title: "Message signage studio regarding new website", scheduledDate: TODAY, dueDate: null }),
];

// Seven tasks completed today (still Today members in the UI; counted as completed).
const COMPLETED: TaskView[] = Array.from({ length: 7 }, (_, i) =>
  view({ id: `c${i}`, title: `completed ${i}`, status: "completed" as TaskStatus, isCompleted: true, scheduledDate: TODAY, completedAt: `${TODAY}T0${i}:00:00Z` })
);

describe("today-summary — reconciliation with Planner Today", () => {
  it("reproduces the 12-Oct Production figures from fixtures (12 total / 7 completed / 5 remaining / 0 overdue)", () => {
    const summary = buildTodaySummary(TODAY, REMAINING, COMPLETED);
    // Derived from the fixtures, not hardcoded:
    expect(summary.remaining).toBe(REMAINING.length); // 5
    expect(summary.completed).toBe(COMPLETED.length); // 7
    expect(summary.totalActionable).toBe(REMAINING.length + COMPLETED.length); // 12
    expect(summary.overdue).toBe(REMAINING.filter((v) => v.isOverdue).length); // 0
  });

  it("identifies the ACTUAL outstanding tasks, not merely a count", () => {
    const summary = buildTodaySummary(TODAY, REMAINING, COMPLETED);
    const titles = summary.remainingTasks.map((t) => t.title);
    expect(titles).toContain("Cuisine Foods website finish before thu");
    expect(titles).toContain("Finish Bos Outdoor website when i have time");
    expect(titles).toContain("Jan frits bel");
    expect(titles).toContain("jarvis Tackle when i have time");
    expect(titles).toContain("Message signage studio regarding new website");
    expect(summary.remainingTasks).toHaveLength(5);
  });

  it("counts a SCHEDULED-today task that has NO due_date (the exact Jarvis undercount bug)", () => {
    const scheduledNoDue = [view({ id: "s1", title: "scheduled only", scheduledDate: TODAY, dueDate: null })];
    const s = buildTodaySummary(TODAY, scheduledNoDue, []);
    expect(s.remaining).toBe(1); // Jarvis's old due_date==today count would have been 0
    expect(s.totalActionable).toBe(1);
  });

  it("counts a DUE-today task with no scheduled_date, and an OVERDUE task, in remaining", () => {
    const dueToday = view({ id: "d1", title: "due only", scheduledDate: null, dueDate: TODAY, isOverdue: false });
    const overdue = view({ id: "o1", title: "overdue", scheduledDate: null, dueDate: "2026-10-01", isOverdue: true });
    const s = buildTodaySummary(TODAY, [dueToday, overdue], []);
    expect(s.remaining).toBe(2);
    expect(s.overdue).toBe(1);
  });

  it("excludes WAITING tasks from remaining (actionable) but not from the active set", () => {
    const waiting = view({ id: "w1", title: "blocked", status: "waiting" as TaskStatus, isWaiting: true, scheduledDate: TODAY });
    const active = view({ id: "a1", title: "active", scheduledDate: TODAY });
    const s = buildTodaySummary(TODAY, [waiting, active], []);
    expect(s.remaining).toBe(1); // only the active one
    expect(s.waiting).toBe(1);
  });

  it("buildTodaySummary agrees with the dashboard's direct summariseTodayTaskViews composition", () => {
    // The dashboard calls summariseTodayTaskViews(active, completed, meetings); Jarvis uses
    // buildTodaySummary. They must yield identical task counts (meetings never affect them).
    const { progress } = summariseTodayTaskViews(REMAINING, COMPLETED, 3 /* arbitrary meetings */);
    const summary = buildTodaySummary(TODAY, REMAINING, COMPLETED);
    expect(summary.remaining).toBe(progress.remaining);
    expect(summary.completed).toBe(progress.completed);
    expect(summary.totalActionable).toBe(progress.totalActionable);
    expect(summary.overdue).toBe(progress.overdue);
  });
});
