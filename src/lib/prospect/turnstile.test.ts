import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { verifyTurnstileToken, isTurnstileConfigured } from "./turnstile";

const OLD = process.env.TURNSTILE_SECRET_KEY;
afterEach(() => {
  process.env.TURNSTILE_SECRET_KEY = OLD;
  vi.unstubAllGlobals();
});

describe("verifyTurnstileToken — fail-closed, no secret leakage", () => {
  it("fails closed (configured:false) when the secret is unset", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const r = await verifyTurnstileToken("anytoken");
    expect(r).toEqual({ ok: false, configured: false });
    expect(isTurnstileConfigured()).toBe(false);
  });

  it("rejects a missing token without hitting the network", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await verifyTurnstileToken(null)).toEqual({ ok: false, configured: true });
    expect(await verifyTurnstileToken("")).toEqual({ ok: false, configured: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns ok on Cloudflare success===true and never sends the secret to the client", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    let sentBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, opts: { body: URLSearchParams }) => {
        sentBody = opts.body.toString();
        return { ok: true, json: async () => ({ success: true }) } as Response;
      })
    );
    const r = await verifyTurnstileToken("good-token");
    expect(r).toEqual({ ok: true, configured: true });
    // Secret goes to Cloudflare only (server-side POST body), never returned.
    expect(sentBody).toContain("secret=secret");
  });

  it("returns not-ok on success===false, non-2xx, malformed body, or network error", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ success: false }) } as Response)));
    expect((await verifyTurnstileToken("t")).ok).toBe(false);

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) } as Response)));
    expect((await verifyTurnstileToken("t")).ok).toBe(false);

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => { throw new Error("bad json"); } } as unknown as Response)));
    expect((await verifyTurnstileToken("t")).ok).toBe(false);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    expect((await verifyTurnstileToken("t")).ok).toBe(false);
  });
});
