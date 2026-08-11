import { describe, it, expect, beforeEach, vi } from "vitest";

// generateForDefinition orchestration: it ignores inactive / non-schedule / no-next
// definitions, materialises via the system dispatch, and advances next_occurrence
// with a WORKSPACE-SCOPED update.
vi.mock("./system-dispatch", () => ({ generateOccurrence: vi.fn() }));

import { generateForDefinition } from "./generator";
import { generateOccurrence } from "./system-dispatch";
import type { RecurringDefinition } from "@/lib/database.types";

// now such that agency-local (UTC+2) date is 2026-08-25.
const NOW = new Date("2026-08-25T06:00:00Z");

const DEF = {
  id: "def-1", workspace_id: "ws1", owner_user_id: "eloff", default_assignee_id: null,
  template_title: "Send Vision Motors invoice", template_description: null, template_priority: "normal",
  template_estimated_minutes: null, template_client_id: "client-vm", rule_interval: 1, rule_unit: "month",
  mode: "schedule", timezone: "Africa/Johannesburg", missed_policy: "skip", due_offset_days: 0,
  next_occurrence: "2026-08-25", anchor_day: 25, active: true, archived_at: null, created_at: "x", updated_at: "x",
} as RecurringDefinition;

/** Fake admin client capturing recurring_definitions updates. */
function fakeAdmin(updates: { vals: unknown; eqs: [string, unknown][] }[]) {
  return {
    from: (_t: string) => ({
      update: (vals: unknown) => {
        const eqs: [string, unknown][] = [];
        const chain = {
          eq: (k: string, v: unknown) => {
            eqs.push([k, v]);
            // resolve after the second .eq (id + workspace_id)
            if (eqs.length >= 2) {
              updates.push({ vals, eqs });
              return Promise.resolve({ error: null });
            }
            return chain;
          },
        };
        return chain;
      },
    }),
  };
}

beforeEach(() => {
  vi.mocked(generateOccurrence).mockReset();
  vi.mocked(generateOccurrence).mockResolvedValue({ outcome: "applied", result_task_id: "t", result_aggregate_version: 1 });
});

describe("generateForDefinition", () => {
  it("is a no-op for an inactive definition", async () => {
    const updates: { vals: unknown; eqs: [string, unknown][] }[] = [];
    const r = await generateForDefinition(fakeAdmin(updates) as never, { ...DEF, active: false }, NOW, { ownerDisplay: "Eloff" });
    expect(generateOccurrence).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(r.advanced).toBe(false);
  });

  it("is a no-op for a completion-mode definition (v1 generates schedule mode only)", async () => {
    const updates: { vals: unknown; eqs: [string, unknown][] }[] = [];
    await generateForDefinition(fakeAdmin(updates) as never, { ...DEF, mode: "completion" }, NOW, { ownerDisplay: "Eloff" });
    expect(generateOccurrence).not.toHaveBeenCalled();
  });

  it("is a no-op when next_occurrence is null", async () => {
    const updates: { vals: unknown; eqs: [string, unknown][] }[] = [];
    await generateForDefinition(fakeAdmin(updates) as never, { ...DEF, next_occurrence: null }, NOW, { ownerDisplay: "Eloff" });
    expect(generateOccurrence).not.toHaveBeenCalled();
  });

  it("materialises the due occurrence and advances next_occurrence (workspace-scoped update)", async () => {
    const updates: { vals: unknown; eqs: [string, unknown][] }[] = [];
    const r = await generateForDefinition(fakeAdmin(updates) as never, DEF, NOW, { ensureFirstSlot: true, ownerDisplay: "Eloff" });

    expect(generateOccurrence).toHaveBeenCalledTimes(1);
    const call = vi.mocked(generateOccurrence).mock.calls[0][0];
    expect(call.slot).toBe("2026-08-25");
    expect(call.scheduledDate).toBe("2026-08-25");
    expect(call.definition.id).toBe("def-1");

    expect(r.created).toBe(1);
    expect(r.advanced).toBe(true);
    // next_occurrence advanced to the next month, scoped to id AND workspace_id.
    expect(updates).toHaveLength(1);
    expect(updates[0].vals).toEqual({ next_occurrence: "2026-09-25" });
    expect(updates[0].eqs).toEqual([["id", "def-1"], ["workspace_id", "ws1"]]);
  });

  it("counts an existing occurrence as accepted_noop (idempotent re-run)", async () => {
    vi.mocked(generateOccurrence).mockResolvedValue({ outcome: "accepted_noop", result_task_id: "t", result_aggregate_version: 1 });
    const updates: { vals: unknown; eqs: [string, unknown][] }[] = [];
    const r = await generateForDefinition(fakeAdmin(updates) as never, DEF, NOW, { ensureFirstSlot: true, ownerDisplay: "Eloff" });
    expect(r.created).toBe(0);
    expect(r.existing).toBe(1);
  });
});
