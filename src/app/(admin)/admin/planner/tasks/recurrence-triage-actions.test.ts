import { describe, it, expect, beforeEach, vi } from "vitest";

// Security-focused tests for the recurring-reminder creation path: the browser can
// never choose workspace/author, non-admins are refused, cross-workspace assignees
// are rejected, and a failed link rolls back the fresh definition.
vi.mock("@/lib/auth", () => ({ getCurrentProfile: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/planner/tasks/run-command", () => ({ runTaskCommand: vi.fn() }));
vi.mock("@/lib/planner/team", () => ({ listAdminTeam: vi.fn() }));
vi.mock("@/lib/planner/recurrence/definitions", () => ({
  createRecurringDefinition: vi.fn(),
  deactivateRecurringDefinition: vi.fn(),
}));
vi.mock("@/lib/planner/recurrence/generator", () => ({ generateForDefinitionId: vi.fn() }));
vi.mock("@/lib/planner/tasks/schedule-date", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/planner/tasks/schedule-date")>();
  return { ...actual, agencyToday: () => "2026-08-04" };
});

import { triageAndScheduleRecurringAction } from "@/app/(admin)/admin/planner/tasks/actions";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { runTaskCommand } from "@/lib/planner/tasks/run-command";
import { listAdminTeam } from "@/lib/planner/team";
import { createRecurringDefinition, deactivateRecurringDefinition } from "@/lib/planner/recurrence/definitions";
import { generateForDefinitionId } from "@/lib/planner/recurrence/generator";

const KEY = "11111111-1111-1111-1111-111111111111";
const ADMIN = { id: "admin-1", role: "admin", full_name: "Eloff", email: "e@b.com", client_id: null, workspace_id: "ws1" };
const TASK = { id: "t9", title: "Send Vision Motors invoice", priority: "normal", status: "inbox", aggregate_version: 4 };
const base = { taskId: "t9", expectedAggregateVersion: 4, idempotencyKey: KEY, scheduledDate: "2026-08-25", unit: "month" as const };

function fakeSupabase(taskRow: unknown, error: unknown = null) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ is: () => ({ maybeSingle: () => Promise.resolve({ data: taskRow, error }) }) }) }),
    }),
  };
}

beforeEach(() => {
  vi.mocked(getCurrentProfile).mockResolvedValue(ADMIN as never);
  vi.mocked(createClient).mockResolvedValue(fakeSupabase(TASK) as never);
  vi.mocked(runTaskCommand).mockReset();
  vi.mocked(runTaskCommand).mockResolvedValue({ ok: true, outcome: "applied", taskId: "t9", aggregateVersion: 5 } as never);
  vi.mocked(listAdminTeam).mockReset();
  vi.mocked(listAdminTeam).mockResolvedValue([{ id: "admin-1", fullName: "Eloff" }, { id: "ashwin", fullName: "Ashwin" }] as never);
  vi.mocked(createRecurringDefinition).mockReset();
  vi.mocked(createRecurringDefinition).mockResolvedValue({ id: "def-1", workspace_id: "ws1", owner_user_id: "admin-1" } as never);
  vi.mocked(deactivateRecurringDefinition).mockReset();
  vi.mocked(deactivateRecurringDefinition).mockResolvedValue({ deactivated: true } as never);
  vi.mocked(generateForDefinitionId).mockReset();
  vi.mocked(generateForDefinitionId).mockResolvedValue({ created: 0, existing: 1, skipped: 0, advanced: true, error: false } as never);
});

describe("triageAndScheduleRecurringAction — authorization", () => {
  it("rejects a client (non-admin) and creates NO definition", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue({ ...ADMIN, role: "client" } as never);
    const res = await triageAndScheduleRecurringAction(base);
    expect(res.ok).toBe(false);
    expect(createRecurringDefinition).not.toHaveBeenCalled();
  });
  it("rejects a rep (non-admin)", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue({ ...ADMIN, role: "rep" } as never);
    const res = await triageAndScheduleRecurringAction(base);
    expect(res.ok).toBe(false);
    expect(createRecurringDefinition).not.toHaveBeenCalled();
  });
  it("rejects an unauthenticated caller", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(null as never);
    expect((await triageAndScheduleRecurringAction(base)).ok).toBe(false);
    expect(createRecurringDefinition).not.toHaveBeenCalled();
  });
  it("rejects an admin with no workspace", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue({ ...ADMIN, workspace_id: null } as never);
    expect((await triageAndScheduleRecurringAction(base)).ok).toBe(false);
    expect(createRecurringDefinition).not.toHaveBeenCalled();
  });
  it("rejects a cross-workspace / non-admin assignee (never in listAdminTeam)", async () => {
    const res = await triageAndScheduleRecurringAction({ ...base, assignedToId: "outsider" });
    expect(res.ok).toBe(false);
    expect(createRecurringDefinition).not.toHaveBeenCalled();
  });
});

describe("triageAndScheduleRecurringAction — validation", () => {
  it("rejects an invalid recurrence unit", async () => {
    const res = await triageAndScheduleRecurringAction({ ...base, unit: "year" as never });
    expect(res.ok).toBe(false);
    expect(createRecurringDefinition).not.toHaveBeenCalled();
  });
  it("rejects a past first date", async () => {
    const res = await triageAndScheduleRecurringAction({ ...base, scheduledDate: "2026-08-03" });
    expect(res.ok).toBe(false);
    expect(createRecurringDefinition).not.toHaveBeenCalled();
  });
  it("rejects when the task is not an inbox task", async () => {
    vi.mocked(createClient).mockResolvedValue(fakeSupabase({ ...TASK, status: "scheduled" }) as never);
    const res = await triageAndScheduleRecurringAction(base);
    expect(res.ok).toBe(false);
    expect(createRecurringDefinition).not.toHaveBeenCalled();
  });
});

describe("triageAndScheduleRecurringAction — happy path", () => {
  it("derives workspace/owner server-side, links the first occurrence, and advances", async () => {
    const res = await triageAndScheduleRecurringAction({ ...base, clientId: "client-vm" });
    expect(res.ok).toBe(true);

    // Definition: workspace + owner are SERVER values; title read server-side from the task.
    expect(createRecurringDefinition).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws1", ownerUserId: "admin-1", title: "Send Vision Motors invoice", firstDate: "2026-08-25", unit: "month", clientId: "client-vm" })
    );
    // First occurrence linked via the triage command (same op contract).
    const cmd = vi.mocked(runTaskCommand).mock.calls[0][0].command as { type: string; recurrence?: { recurrence_definition_id: string; occurrence_slot: string } };
    expect(cmd.type).toBe("TriageAndScheduleTask");
    expect(cmd.recurrence).toMatchObject({ recurrence_definition_id: "def-1", occurrence_slot: "2026-08-25" });
    // Generator advances next_occurrence + fills look-ahead.
    expect(generateForDefinitionId).toHaveBeenCalledWith("def-1");
    expect(deactivateRecurringDefinition).not.toHaveBeenCalled();
  });

  it("rolls back the definition when linking fails (compensating deactivate)", async () => {
    vi.mocked(runTaskCommand).mockResolvedValue({ ok: false, code: "VersionConflict", error: "changed" } as never);
    const res = await triageAndScheduleRecurringAction(base);
    expect(res.ok).toBe(false);
    expect(deactivateRecurringDefinition).toHaveBeenCalledWith("ws1", "def-1");
    expect(generateForDefinitionId).not.toHaveBeenCalled();
  });
});
