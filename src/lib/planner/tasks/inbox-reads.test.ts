import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/flags", () => ({ isTasksEnabled: vi.fn(() => true) }));
vi.mock("@/lib/auth", () => ({ getCurrentProfile: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { getInboxTasks } from "./read-adapters";
import { TaskError, type TaskErrorCode } from "./errors";
import { isTasksEnabled } from "@/lib/flags";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const ADMIN = { id: "admin-1", role: "admin", full_name: "Eloff", email: null, client_id: null };

function fakeSupabase({ rows = [] as unknown[], error = null as unknown } = {}) {
  const calls = { eq: [] as [string, unknown][], is: [] as [string, unknown][], order: [] as [string, unknown][] };
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((c: string, v: unknown) => { calls.eq.push([c, v]); return builder; }),
    is: vi.fn((c: string, v: unknown) => { calls.is.push([c, v]); return builder; }),
    order: vi.fn((c: string, o: unknown) => { calls.order.push([c, o]); return Promise.resolve({ data: rows, error }); }),
  };
  return { client: { from: vi.fn(() => builder) }, calls };
}

async function expectCode(p: Promise<unknown>, code: TaskErrorCode) {
  await expect(p).rejects.toBeInstanceOf(TaskError);
  await p.catch((e) => expect((e as TaskError).code).toBe(code));
}

beforeEach(() => {
  vi.mocked(isTasksEnabled).mockReturnValue(true);
  vi.mocked(getCurrentProfile).mockResolvedValue(ADMIN as never);
});

describe("getInboxTasks — gating", () => {
  it("flag off → TasksDisabled", async () => {
    vi.mocked(isTasksEnabled).mockReturnValue(false);
    await expectCode(getInboxTasks(), "TasksDisabled");
  });
  it("no session → NotAuthenticated", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(null);
    await expectCode(getInboxTasks(), "NotAuthenticated");
  });
  it("non-admin → NotAuthorized", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue({ ...ADMIN, role: "client" } as never);
    await expectCode(getInboxTasks(), "NotAuthorized");
  });
  it("db error → PersistenceError", async () => {
    const { client } = fakeSupabase({ error: { code: "XX000" } });
    vi.mocked(createClient).mockResolvedValue(client as never);
    await expectCode(getInboxTasks(), "PersistenceError");
  });
});

describe("getInboxTasks — query shape (shared agency inbox, Decision 1)", () => {
  it("filters status='inbox' + deleted_at is null, newest first, and NO owner/assignee/created_by filter", async () => {
    const rows = [{ id: "a", status: "inbox" }, { id: "b", status: "inbox" }];
    const { client, calls } = fakeSupabase({ rows });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const result = await getInboxTasks();
    expect(result).toEqual(rows);

    // status='inbox' and NO scoping by identity columns.
    expect(calls.eq).toContainEqual(["status", "inbox"]);
    const eqCols = calls.eq.map(([c]) => c);
    expect(eqCols).not.toContain("assignee_id");
    expect(eqCols).not.toContain("owner_user_id");
    expect(eqCols).not.toContain("created_by");

    // deleted rows excluded; newest capture first.
    expect(calls.is).toContainEqual(["deleted_at", null]);
    expect(calls.order).toContainEqual(["created_at", { ascending: false }]);
  });
});
