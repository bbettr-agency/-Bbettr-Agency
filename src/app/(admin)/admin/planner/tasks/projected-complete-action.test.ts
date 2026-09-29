import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/flags", () => ({ isTasksEnabled: () => true, isPlannerEnabled: () => true }));
vi.mock("@/lib/auth", () => ({ getCurrentProfile: vi.fn() }));
vi.mock("@/lib/planner/tasks/run-command", () => ({ runTaskCommand: vi.fn() }));
vi.mock("@/lib/planner/recurrence/system-dispatch", () => ({ generateOccurrence: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { completeProjectedOccurrenceAction } from "@/app/(admin)/admin/planner/tasks/actions";
import { getCurrentProfile } from "@/lib/auth";
import { runTaskCommand } from "@/lib/planner/tasks/run-command";
import { generateOccurrence } from "@/lib/planner/recurrence/system-dispatch";
import { createClient } from "@/lib/supabase/server";

const KEY = "11111111-1111-1111-1111-111111111111";
const ME = "admin-1";
const ADMIN = { id: ME, role: "admin", full_name: "Eloff", email: "e@b.com", client_id: null, workspace_id: "ws1" };
const OK = { ok: true, outcome: "applied", taskId: "task-1", aggregateVersion: 2 } as const;

/** Minimal chainable Supabase stub: every filter returns `this`; maybeSingle resolves. */
function makeSupabase(opts: { def?: unknown; defErr?: unknown; row?: unknown; rowErr?: unknown }) {
  const builder = (result: unknown) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "order"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve(result);
    return b;
  };
  return {
    from: (table: string) =>
      table === "recurring_definitions"
        ? builder({ data: opts.def ?? null, error: opts.defErr ?? null })
        : builder({ data: opts.row ?? null, error: opts.rowErr ?? null }),
  };
}

const def = (o: Record<string, unknown> = {}) => ({
  id: "def-1", active: true, owner_user_id: ME, default_assignee_id: null, due_offset_days: 0,
  workspace_id: "ws1", template_title: "Invoice", template_priority: "normal", template_client_id: null, ...o,
});

beforeEach(() => {
  vi.mocked(getCurrentProfile).mockResolvedValue(ADMIN as never);
  vi.mocked(runTaskCommand).mockReset().mockResolvedValue({ ...OK } as never);
  vi.mocked(generateOccurrence).mockReset().mockResolvedValue({ outcome: "applied", result_task_id: "task-1", result_aggregate_version: 1 } as never);
  vi.mocked(createClient).mockReset();
});

describe("completeProjectedOccurrenceAction — authorization", () => {
  it("rejects a non-admin", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue({ ...ADMIN, role: "rep" } as never);
    const r = await completeProjectedOccurrenceAction({ definitionId: "def-1", slot: "2026-09-28", idempotencyKey: KEY });
    expect(r.ok).toBe(false);
    expect(vi.mocked(generateOccurrence)).not.toHaveBeenCalled();
  });

  it("rejects when the caller is neither owner nor default assignee (never materialise another series)", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ def: def({ owner_user_id: "someone-else", default_assignee_id: "also-not-me" }) }) as never);
    const r = await completeProjectedOccurrenceAction({ definitionId: "def-1", slot: "2026-09-28", idempotencyKey: KEY });
    expect(r).toMatchObject({ ok: false, code: "NotAuthorized" });
    expect(vi.mocked(generateOccurrence)).not.toHaveBeenCalled();
  });

  it("rejects a malformed slot before touching the database", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ def: def() }) as never);
    const r = await completeProjectedOccurrenceAction({ definitionId: "def-1", slot: "not-a-date", idempotencyKey: KEY });
    expect(r).toMatchObject({ ok: false, code: "InvalidCommand" });
    expect(vi.mocked(generateOccurrence)).not.toHaveBeenCalled();
  });

  it("rejects an inactive definition", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ def: def({ active: false }) }) as never);
    const r = await completeProjectedOccurrenceAction({ definitionId: "def-1", slot: "2026-09-28", idempotencyKey: KEY });
    expect(r).toMatchObject({ ok: false, code: "InvalidCommand" });
  });
});

describe("completeProjectedOccurrenceAction — materialise-then-complete", () => {
  it("materialises the exact slot, then completes the resulting row", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ def: def(), row: { id: "task-1", status: "scheduled", aggregate_version: 1 } }) as never);
    const r = await completeProjectedOccurrenceAction({ definitionId: "def-1", slot: "2026-09-28", idempotencyKey: KEY });

    expect(vi.mocked(generateOccurrence)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generateOccurrence).mock.calls[0][0]).toMatchObject({ slot: "2026-09-28", scheduledDate: "2026-09-28", dueDate: "2026-09-28" });
    expect(vi.mocked(runTaskCommand)).toHaveBeenCalledTimes(1);
    const cmd = vi.mocked(runTaskCommand).mock.calls[0][0];
    expect(cmd).toMatchObject({ command: { type: "CompleteTask" }, task_id: "task-1", expected_aggregate_version: 1, idempotency_key: KEY });
    expect(r.ok).toBe(true);
  });

  it("honours a due_offset_days when materialising", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ def: def({ due_offset_days: 2 }), row: { id: "task-1", status: "scheduled", aggregate_version: 1 } }) as never);
    await completeProjectedOccurrenceAction({ definitionId: "def-1", slot: "2026-09-28", idempotencyKey: KEY });
    expect(vi.mocked(generateOccurrence).mock.calls[0][0]).toMatchObject({ dueDate: "2026-09-30" });
  });

  it("an ALREADY-completed occurrence is an idempotent success — no re-complete", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ def: def(), row: { id: "task-1", status: "completed", aggregate_version: 5 } }) as never);
    const r = await completeProjectedOccurrenceAction({ definitionId: "def-1", slot: "2026-09-28", idempotencyKey: KEY });
    expect(r).toMatchObject({ ok: true });
    expect(vi.mocked(runTaskCommand)).not.toHaveBeenCalled(); // no double completion
  });

  it("a failed materialisation never yields a false completed", async () => {
    vi.mocked(generateOccurrence).mockRejectedValue(new Error("boom"));
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ def: def() }) as never);
    const r = await completeProjectedOccurrenceAction({ definitionId: "def-1", slot: "2026-09-28", idempotencyKey: KEY });
    expect(r.ok).toBe(false);
    expect(vi.mocked(runTaskCommand)).not.toHaveBeenCalled();
  });
});
