import { describe, it, expect } from "vitest";
import { toTaskView } from "./task-view";
import type { Task } from "@/lib/database.types";

const TODAY = "2026-08-04";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1", workspace_id: "ws1", title: "Alpha", description: null, status: "planned",
    created_by: "admin-1", owner_user_id: "admin-1", assignee_id: null, priority: "normal",
    critical_reason: null, estimated_minutes: null, scheduled_date: null, due_date: null,
    started_at: null, completed_at: null, completed_by: null, archived_at: null, archive_reason: null,
    blocked_since: null, resume_target: null, aggregate_version: 3, parent_id: null, client_id: null,
    recurrence_definition_id: null, occurrence_slot: null, created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z", deleted_at: null, ...overrides,
  } as Task;
}
const names = new Map<string, string>([["admin-1", "Eloff"], ["admin-2", " "]]);

describe("toTaskView", () => {
  it("maps only presentation-safe fields (no raw Task leakage)", () => {
    const v = toTaskView(task({ scheduled_date: "2026-08-04", estimated_minutes: 30 }), names, TODAY);
    expect(v).toEqual({
      id: "t1", title: "Alpha", status: "planned", priority: "normal", criticalReason: null,
      scheduledDate: "2026-08-04", dueDate: null, estimatedMinutes: 30, isOverdue: false,
      isWaiting: false, blockedSince: null, ownerDisplay: "Eloff", assigneeDisplay: null, aggregateVersion: 3,
    });
  });
  it("derives isOverdue (due date strictly before today, non-terminal)", () => {
    expect(toTaskView(task({ due_date: "2026-08-03" }), names, TODAY).isOverdue).toBe(true);
    expect(toTaskView(task({ due_date: "2026-08-04" }), names, TODAY).isOverdue).toBe(false); // due today ≠ overdue
    expect(toTaskView(task({ due_date: "2026-08-03", status: "completed" }), names, TODAY).isOverdue).toBe(false);
  });
  it("flags waiting + carries blockedSince", () => {
    const v = toTaskView(task({ status: "waiting", blocked_since: "2026-08-02T09:00:00Z" }), names, TODAY);
    expect(v.isWaiting).toBe(true);
    expect(v.blockedSince).toBe("2026-08-02T09:00:00Z");
  });
  it("surfaces criticalReason ONLY when priority critical and a real reason exists", () => {
    expect(toTaskView(task({ priority: "critical", critical_reason: "Launch blocker" }), names, TODAY).criticalReason).toBe("Launch blocker");
    expect(toTaskView(task({ priority: "critical", critical_reason: "  " }), names, TODAY).criticalReason).toBeNull();
    expect(toTaskView(task({ priority: "normal", critical_reason: "ignored" }), names, TODAY).criticalReason).toBeNull();
  });
  it("resolves names best-effort; unresolved/blank → null, never throws", () => {
    expect(toTaskView(task({ owner_user_id: "ghost", assignee_id: "admin-2" }), names, TODAY).ownerDisplay).toBeNull();
    expect(toTaskView(task({ assignee_id: "admin-2" }), names, TODAY).assigneeDisplay).toBeNull(); // whitespace name → null
    expect(toTaskView(task({ owner_user_id: null }), names, TODAY).ownerDisplay).toBeNull();
  });
});
