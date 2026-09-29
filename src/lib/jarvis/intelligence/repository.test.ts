import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { createConversationRepo } from "./repository";
import { createAdminClient } from "@/lib/supabase/admin";
import type { JarvisContext } from "@/lib/jarvis/identity";

const CTX: JarvisContext = { principalId: "user-1", workspaceId: "ws-1", grants: new Set() };
const THREAD = "22222222-2222-4222-8222-222222222222";

/**
 * Minimal chainable Supabase stub for loadBoundedHistory. Records the table order,
 * the owner-check predicates (jarvis_threads), the message predicates, and the
 * order/limit — so tests can assert the trusted three-dimension gate AND that the
 * message query is NEVER built when ownership fails.
 */
function makeAdmin(opts: { owned: boolean; messages?: Array<{ role: string; content: string; seq: number }> }) {
  const calls = {
    tables: [] as string[],
    threadEq: {} as Record<string, unknown>,
    msgEq: {} as Record<string, unknown>,
    order: null as null | { col: string; opts: unknown },
    limit: null as number | null,
  };
  const threadBuilder = () => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      calls.threadEq[col] = val;
      return b;
    };
    b.maybeSingle = () => Promise.resolve({ data: opts.owned ? { id: THREAD } : null, error: null });
    return b;
  };
  const msgBuilder = () => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      calls.msgEq[col] = val;
      return b;
    };
    b.order = (col: string, o: unknown) => {
      calls.order = { col, opts: o };
      return b;
    };
    b.limit = (n: number) => {
      calls.limit = n;
      return Promise.resolve({ data: opts.messages ?? [], error: null });
    };
    return b;
  };
  const admin = {
    from: (table: string) => {
      calls.tables.push(table);
      if (table === "jarvis_threads") return threadBuilder();
      if (table === "jarvis_messages") return msgBuilder();
      throw new Error(`unexpected table: ${table}`);
    },
  };
  return { admin, calls };
}

beforeEach(() => vi.mocked(createAdminClient).mockReset());

describe("loadBoundedHistory — owner-scoped read (F-03 defense-in-depth)", () => {
  it("OWNED thread (thread+workspace+user match) loads history; status/order/limit/mapping preserved", async () => {
    // DB returns newest-first (seq desc); the repo reverses to chronological.
    const { admin, calls } = makeAdmin({
      owned: true,
      messages: [
        { role: "assistant", content: "b", seq: 2 },
        { role: "user", content: "a", seq: 1 },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const out = await createConversationRepo().loadBoundedHistory(CTX, THREAD, 10);

    // Chronological + role/content only (seq dropped).
    expect(out).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ]);
    // Owner gate ran first, then the message read.
    expect(calls.tables).toEqual(["jarvis_threads", "jarvis_messages"]);
    // Existing message-query semantics unchanged.
    expect(calls.msgEq).toEqual({ thread_id: THREAD, workspace_id: "ws-1", status: "ok" });
    expect(calls.order).toEqual({ col: "seq", opts: { ascending: false } });
    expect(calls.limit).toBe(10);
  });

  it("WRONG USER → [] and the message-history query is NEVER executed (fail closed)", async () => {
    const { admin, calls } = makeAdmin({ owned: false });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const out = await createConversationRepo().loadBoundedHistory(CTX, THREAD, 10);

    expect(out).toEqual([]);
    expect(calls.tables).toEqual(["jarvis_threads"]); // jarvis_messages NEVER queried
    expect(calls.tables).not.toContain("jarvis_messages");
    // The owner check was scoped to the trusted principal.
    expect(calls.threadEq.user_id).toBe("user-1");
  });

  it("WRONG WORKSPACE → [] and the message-history query is NEVER executed (fail closed)", async () => {
    const { admin, calls } = makeAdmin({ owned: false });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const out = await createConversationRepo().loadBoundedHistory(CTX, THREAD, 10);

    expect(out).toEqual([]);
    expect(calls.tables).not.toContain("jarvis_messages");
    expect(calls.threadEq.workspace_id).toBe("ws-1");
  });

  it("owner verification uses ctx.principalId + ctx.workspaceId + the supplied thread id (trusted identity only)", async () => {
    const { admin, calls } = makeAdmin({ owned: true, messages: [] });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    await createConversationRepo().loadBoundedHistory(CTX, THREAD, 5);

    expect(calls.threadEq).toEqual({ id: THREAD, workspace_id: "ws-1", user_id: "user-1" });
  });

  it("CONTINUITY: an owned thread still loads its full transcript in order", async () => {
    const { admin } = makeAdmin({
      owned: true,
      messages: [
        { role: "assistant", content: "a2", seq: 4 },
        { role: "user", content: "q2", seq: 3 },
        { role: "assistant", content: "a1", seq: 2 },
        { role: "user", content: "q1", seq: 1 },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const out = await createConversationRepo().loadBoundedHistory(CTX, THREAD, 20);

    expect(out).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
    ]);
  });

  it("bounded limit floor preserved: limit(0) → Math.max(1,0) = 1", async () => {
    const { admin, calls } = makeAdmin({ owned: true, messages: [] });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    await createConversationRepo().loadBoundedHistory(CTX, THREAD, 0);

    expect(calls.limit).toBe(1);
  });
});
