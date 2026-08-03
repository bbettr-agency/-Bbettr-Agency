import { describe, it, expect } from "vitest";
import { isOverdue, isScheduledToday, isTodayMember, isActiveQueueEligible, partitionToday, type TodayTaskLike } from "./today-membership";

const t = (o: Partial<TodayTaskLike>): TodayTaskLike => ({ status: "scheduled", scheduled_date: null, due_date: null, deleted_at: null, ...o });
const TODAY = "2026-08-03";

describe("today-membership", () => {
  it("scheduled today is a member", () => {
    expect(isScheduledToday(t({ scheduled_date: TODAY }), TODAY)).toBe(true);
    expect(isTodayMember(t({ scheduled_date: TODAY }), TODAY)).toBe(true);
  });
  it("scheduled tomorrow is NOT a member (unless overdue)", () => {
    expect(isTodayMember(t({ scheduled_date: "2026-08-04" }), TODAY)).toBe(false);
  });
  it("overdue = due strictly before today and not terminal", () => {
    expect(isOverdue(t({ due_date: "2026-08-01", status: "scheduled" }), TODAY)).toBe(true);
    expect(isOverdue(t({ due_date: TODAY, status: "scheduled" }), TODAY)).toBe(false); // due today is not overdue
    expect(isOverdue(t({ due_date: "2026-08-01", status: "completed" }), TODAY)).toBe(false);
    expect(isOverdue(t({ due_date: "2026-08-01", status: "archived" }), TODAY)).toBe(false);
  });
  it("due later but scheduled today is a member (scheduled∪overdue)", () => {
    expect(isTodayMember(t({ scheduled_date: TODAY, due_date: "2026-08-20" }), TODAY)).toBe(true);
  });
  it("overdue but scheduled tomorrow is still a member (overdue wins)", () => {
    expect(isTodayMember(t({ scheduled_date: "2026-08-04", due_date: "2026-08-01" }), TODAY)).toBe(true);
  });
  it("deleted rows are never members", () => {
    expect(isTodayMember(t({ scheduled_date: TODAY, deleted_at: "2026-08-02" }), TODAY)).toBe(false);
  });
  it("active-queue excludes completed/archived/waiting/deleted", () => {
    expect(isActiveQueueEligible(t({ status: "in_progress" }))).toBe(true);
    expect(isActiveQueueEligible(t({ status: "waiting" }))).toBe(false);
    expect(isActiveQueueEligible(t({ status: "completed" }))).toBe(false);
    expect(isActiveQueueEligible(t({ status: "archived" }))).toBe(false);
    expect(isActiveQueueEligible(t({ status: "in_progress", deleted_at: "x" }))).toBe(false);
  });
  it("partitionToday splits queue vs waiting from members only", () => {
    const tasks = [
      t({ scheduled_date: TODAY, status: "scheduled" }), // queue
      t({ scheduled_date: TODAY, status: "waiting" }), // waiting
      t({ due_date: "2026-08-01", status: "in_progress" }), // overdue → queue
      t({ scheduled_date: "2026-08-09", status: "scheduled" }), // not a member → dropped
      t({ scheduled_date: TODAY, status: "completed" }), // member but not queue-eligible, not waiting
    ];
    const { queue, waiting } = partitionToday(tasks, TODAY);
    expect(queue).toHaveLength(2);
    expect(waiting).toHaveLength(1);
  });
  it("agency-date boundary is string-compared (caller supplies agency today)", () => {
    // A task due 2026-08-02 is overdue on 2026-08-03 but not on 2026-08-02.
    const task = t({ due_date: "2026-08-02", status: "scheduled" });
    expect(isOverdue(task, "2026-08-03")).toBe(true);
    expect(isOverdue(task, "2026-08-02")).toBe(false);
  });
});
