import { describe, it, expect, beforeEach, vi } from "vitest";

// The privileged system dispatch must build a FIXED RecurringInstanceGenerated
// envelope from the trusted definition — explicit workspace, owner-attributed
// actor, deterministic idempotency key, inherited fields — and nothing else.
vi.mock("@/lib/planner/tasks/service-role-operations", () => ({ invokeApplyTaskCommand: vi.fn() }));

import { generateOccurrence, occurrenceIdempotencyKey } from "./system-dispatch";
import { invokeApplyTaskCommand } from "@/lib/planner/tasks/service-role-operations";
import type { RecurringDefinition } from "@/lib/database.types";

const DEF = {
  id: "def-1",
  workspace_id: "ws1",
  owner_user_id: "eloff",
  default_assignee_id: null,
  template_title: "Send Vision Motors invoice",
  template_description: null,
  template_priority: "normal",
  template_estimated_minutes: null,
  template_client_id: "client-vm",
  rule_interval: 1,
  rule_unit: "month",
  mode: "schedule",
  timezone: "Africa/Johannesburg",
  missed_policy: "skip",
  due_offset_days: 0,
  next_occurrence: "2026-08-25",
  anchor_day: 25,
  active: true,
  archived_at: null,
  created_at: "x",
  updated_at: "x",
} as RecurringDefinition;

beforeEach(() => {
  vi.mocked(invokeApplyTaskCommand).mockReset();
  vi.mocked(invokeApplyTaskCommand).mockResolvedValue({ outcome: "applied", result_task_id: "task-x", result_aggregate_version: 1 });
});

describe("generateOccurrence — envelope", () => {
  it("builds a workspace-explicit, owner-attributed, inherited envelope", async () => {
    await generateOccurrence({ definition: DEF, slot: "2026-08-25", scheduledDate: "2026-08-25", dueDate: "2026-08-25", ownerDisplay: "Eloff" });
    const env = vi.mocked(invokeApplyTaskCommand).mock.calls[0][0];

    expect(env.command_type).toBe("RecurringInstanceGenerated");
    expect(env.workspace_id).toBe("ws1"); // EXPLICIT trusted context, not a browser value
    expect(env.task_id).toBeNull();
    expect(env.expected_aggregate_version).toBeNull();
    expect(env.command_idempotency_key).toBe("recur:def-1:2026-08-25"); // deterministic
    expect(env.actor).toEqual({ actor_kind: "user", actor_user_id: "eloff", actor_ref: null, actor_display: "Eloff" });
    expect(env.task_field_deltas).toMatchObject({
      status: "scheduled",
      title: "Send Vision Motors invoice",
      owner_user_id: "eloff",
      assignee_id: null,
      client_id: "client-vm", // client inheritance
      priority: "normal",
      scheduled_date: "2026-08-25",
      due_date: "2026-08-25",
      recurrence_definition_id: "def-1",
      occurrence_slot: "2026-08-25",
    });
    expect(env.ordered_events.map((e) => e.event_type)).toEqual(["RecurringInstanceGenerated"]);
  });

  it("inherits the default assignee when the definition sets one", async () => {
    await generateOccurrence({ definition: { ...DEF, default_assignee_id: "ashwin" }, slot: "2026-09-25", scheduledDate: "2026-09-25", dueDate: "2026-09-25", ownerDisplay: "Eloff" });
    expect(vi.mocked(invokeApplyTaskCommand).mock.calls[0][0].task_field_deltas?.assignee_id).toBe("ashwin");
  });

  it("throws (never silently mis-attributes) when workspace/owner are missing", async () => {
    await expect(generateOccurrence({ definition: { ...DEF, workspace_id: "" } as RecurringDefinition, slot: "s", scheduledDate: "s", dueDate: "s", ownerDisplay: "X" })).rejects.toThrow();
    await expect(generateOccurrence({ definition: { ...DEF, owner_user_id: "" } as RecurringDefinition, slot: "s", scheduledDate: "s", dueDate: "s", ownerDisplay: "X" })).rejects.toThrow();
  });

  it("occurrenceIdempotencyKey is deterministic per (definition, slot)", () => {
    expect(occurrenceIdempotencyKey("def-1", "2026-08-25")).toBe("recur:def-1:2026-08-25");
  });
});
