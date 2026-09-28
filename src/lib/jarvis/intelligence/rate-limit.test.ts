import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> => ({ data: { allowed: true }, error: null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

import { checkJarvisRateLimit, RATE_LIMITS } from "./rate-limit";

const ID = { workspaceId: "w1", userId: "u1" };

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: { allowed: true }, error: null });
});

describe("checkJarvisRateLimit", () => {
  it("allowed → { ok:true, allowed:true } and passes trusted ids + server-constant limits", async () => {
    const r = await checkJarvisRateLimit(ID);
    expect(r).toEqual({ ok: true, allowed: true });
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(args).toEqual({
      p_workspace: "w1",
      p_user: "u1",
      p_per_minute: RATE_LIMITS.perMinute,
      p_per_hour: RATE_LIMITS.perHour,
      p_per_day: RATE_LIMITS.perDay,
    });
  });

  it("denied → { ok:true, allowed:false, retryAfterSeconds } (ceil, ≥1)", async () => {
    rpc.mockResolvedValueOnce({ data: { allowed: false, retry_after: 42.2 }, error: null });
    const r = await checkJarvisRateLimit(ID);
    expect(r).toEqual({ ok: true, allowed: false, retryAfterSeconds: 43 });
  });

  it("denied with missing/invalid retry_after → floors to 1", async () => {
    rpc.mockResolvedValueOnce({ data: { allowed: false }, error: null });
    expect(await checkJarvisRateLimit(ID)).toEqual({ ok: true, allowed: false, retryAfterSeconds: 1 });
    rpc.mockResolvedValueOnce({ data: { allowed: false, retry_after: -5 }, error: null });
    expect(await checkJarvisRateLimit(ID)).toEqual({ ok: true, allowed: false, retryAfterSeconds: 1 });
  });

  it("RPC error → fail closed { ok:false }, raw error not surfaced", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "SENSITIVE db=prod pw=secret" } });
    const r = await checkJarvisRateLimit(ID);
    expect(r).toEqual({ ok: false });
    expect(JSON.stringify(r)).not.toContain("SENSITIVE");
  });

  it("RPC throws → fail closed { ok:false }, exception not surfaced", async () => {
    rpc.mockImplementationOnce(async () => {
      throw new Error("SENSITIVE connection refused 10.0.0.1");
    });
    const r = await checkJarvisRateLimit(ID);
    expect(r).toEqual({ ok: false });
    expect(JSON.stringify(r)).not.toContain("SENSITIVE");
  });

  it("null data → fail closed", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await checkJarvisRateLimit(ID)).toEqual({ ok: false });
  });
});
