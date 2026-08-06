import { describe, it, expect, beforeEach, vi } from "vitest";

// Isolate the erase action from the command path: it does NOT go through
// runTaskCommand/apply_task_command. Mock the flag, auth, session client, and
// next/cache so we can assert control flow (flag → admin → RPC → revalidate).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentProfile: vi.fn() }));
vi.mock("@/lib/flags", () => ({ isTasksEnabled: vi.fn(() => true) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// The action file also imports runTaskCommand + read-adapters (for the other
// exports); stub them so importing the module never touches real modules.
vi.mock("@/lib/planner/tasks/run-command", () => ({ runTaskCommand: vi.fn() }));
vi.mock("@/lib/planner/tasks/read-adapters", () => ({ getActiveBlockersFor: vi.fn() }));

import { eraseTaskAction } from "@/app/(admin)/admin/planner/tasks/actions";
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth";
import { isTasksEnabled } from "@/lib/flags";
import { createClient } from "@/lib/supabase/server";

const TID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ADMIN = { id: "admin-1", role: "admin", full_name: "Eloff", email: "e@b.com", client_id: null };

function clientWithRpc(rpc: ReturnType<typeof vi.fn>) {
  vi.mocked(createClient).mockResolvedValue({ rpc } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTasksEnabled).mockReturnValue(true);
  vi.mocked(getCurrentProfile).mockResolvedValue(ADMIN as never);
});

describe("eraseTaskAction", () => {
  it("calls erase_task with the task id and revalidates My Tasks + overview on success", async () => {
    const rpc = vi.fn(async () => ({ data: TID, error: null }));
    clientWithRpc(rpc);
    const res = await eraseTaskAction({ taskId: TID });
    expect(rpc).toHaveBeenCalledWith("erase_task", { p_task_id: TID });
    expect(res).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/planner/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/planner");
  });

  it("is idempotent: a NULL return (already erased / missing / other workspace) is still ok:true", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    clientWithRpc(rpc);
    expect(await eraseTaskAction({ taskId: TID })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("erase_task", { p_task_id: TID });
  });

  it("does nothing (never opens a client, never revalidates) when TASKS_ENABLED is off", async () => {
    vi.mocked(isTasksEnabled).mockReturnValue(false);
    const res = await eraseTaskAction({ taskId: TID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not enabled/i);
    expect(createClient).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a non-admin session before any DB access (NotAuthorized)", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue({ ...ADMIN, role: "client" } as never);
    const res = await eraseTaskAction({ taskId: TID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/permission/i);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated session before any DB access (NotAuthenticated)", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(null);
    const res = await eraseTaskAction({ taskId: TID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/signed in/i);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects an empty/whitespace task id before any DB access (InvalidCommand)", async () => {
    for (const bad of ["", "   "]) {
      vi.clearAllMocks();
      vi.mocked(isTasksEnabled).mockReturnValue(true);
      vi.mocked(getCurrentProfile).mockResolvedValue(ADMIN as never);
      const res = await eraseTaskAction({ taskId: bad });
      expect(res.ok).toBe(false);
      expect(createClient).not.toHaveBeenCalled();
    }
  });

  it("maps a DB/RPC failure to a SAFE message (no raw text) and does NOT revalidate or report success", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "permission denied for schema secret_internal", code: "42501" } }));
    clientWithRpc(rpc);
    const res = await eraseTaskAction({ taskId: TID });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).not.toMatch(/secret_internal/); // raw database text never leaks
      expect(res.error.length).toBeGreaterThan(0);
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
