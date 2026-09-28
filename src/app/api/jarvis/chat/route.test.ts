import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/flags", () => ({ isJarvisEnabled: vi.fn(() => true), isJarvisIntelligenceEnabled: vi.fn(() => true) }));
vi.mock("@/lib/jarvis/identity", () => ({ resolveJarvisContextApi: vi.fn() }));
vi.mock("@/lib/jarvis/llm/factory", () => ({ createLLMProvider: vi.fn(() => ({ id: "p", model: "m", complete: vi.fn() })) }));
vi.mock("@/lib/jarvis/intelligence/orchestrator", () => ({ runDurableTurn: vi.fn() }));

import { POST } from "./route";
import { isJarvisEnabled, isJarvisIntelligenceEnabled } from "@/lib/flags";
import { resolveJarvisContextApi } from "@/lib/jarvis/identity";
import { createLLMProvider } from "@/lib/jarvis/llm/factory";
import { runDurableTurn } from "@/lib/jarvis/intelligence/orchestrator";

const APP = "https://portal.example.com";
const KEY = "11111111-1111-4111-8111-111111111111";
const THREAD = "22222222-2222-4222-8222-222222222222";
const CTX = { principalId: "u1", workspaceId: "w1", grants: new Set(["jarvis.use"]) };
const OK_OUTCOME = { kind: "executed", turnId: "turn-1", result: { ok: true, threadId: THREAD, requestId: "corr-1", assistantMessage: "hi", persisted: true } };

function req(body: unknown, headers: Record<string, string> = {}): Request {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(`${APP}/api/jarvis/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: text,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = APP;
  vi.mocked(isJarvisEnabled).mockReturnValue(true);
  vi.mocked(isJarvisIntelligenceEnabled).mockReturnValue(true);
  vi.mocked(resolveJarvisContextApi).mockResolvedValue(CTX as never);
  vi.mocked(createLLMProvider).mockReturnValue({ id: "p", model: "m", complete: vi.fn() } as never);
  vi.mocked(runDurableTurn).mockResolvedValue(OK_OUTCOME as never);
});

describe("POST /api/jarvis/chat — origin / fetch-metadata", () => {
  it("cross-site Sec-Fetch-Site → 403 bad_origin", async () => {
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }, { "sec-fetch-site": "cross-site" }));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "bad_origin" });
    expect(resolveJarvisContextApi).not.toHaveBeenCalled();
  });
  it("mismatched Origin → 403 bad_origin", async () => {
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }, { origin: "https://evil.com" }));
    expect(r.status).toBe(403);
  });
  it("matching Origin proceeds", async () => {
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }, { origin: APP, "sec-fetch-site": "same-origin" }));
    expect(r.status).toBe(200);
  });
  it("absent Origin + Sec-Fetch-Site proceeds to auth", async () => {
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }));
    expect(r.status).toBe(200);
  });
});

describe("POST /api/jarvis/chat — auth (before disabled 404)", () => {
  it("unauthenticated → 401", async () => {
    vi.mocked(resolveJarvisContextApi).mockResolvedValue({ denied: "unauthenticated" } as never);
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "unauthenticated" });
  });
  it.each(["forbidden_role"] as const)("%s → 403 forbidden", async (denied) => {
    vi.mocked(resolveJarvisContextApi).mockResolvedValue({ denied } as never);
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "forbidden" });
  });
  it.each(["no_workspace", "not_enabled"] as const)("%s → 403 jarvis_unavailable", async (denied) => {
    vi.mocked(resolveJarvisContextApi).mockResolvedValue({ denied } as never);
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "jarvis_unavailable" });
  });
  it("unauthenticated + disabled → 401 (auth precedes the disabled 404; cannot probe enablement)", async () => {
    vi.mocked(isJarvisIntelligenceEnabled).mockReturnValue(false);
    vi.mocked(resolveJarvisContextApi).mockResolvedValue({ denied: "unauthenticated" } as never);
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }));
    expect(r.status).toBe(401);
  });
});

describe("POST /api/jarvis/chat — feature gate", () => {
  it("authorized + disabled → 404, provider + runDurableTurn NOT called", async () => {
    vi.mocked(isJarvisIntelligenceEnabled).mockReturnValue(false);
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "not_found" });
    expect(createLLMProvider).not.toHaveBeenCalled();
    expect(runDurableTurn).not.toHaveBeenCalled();
    expect(resolveJarvisContextApi).toHaveBeenCalled(); // auth ran first
  });
});

describe("POST /api/jarvis/chat — content-type / body / schema", () => {
  it("wrong content-type → 415", async () => {
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }, { "content-type": "text/plain" }));
    expect(r.status).toBe(415);
  });
  it("application/json; charset=utf-8 accepted", async () => {
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }, { "content-type": "application/json; charset=utf-8" }));
    expect(r.status).toBe(200);
  });
  it("malformed JSON → 400 invalid_json", async () => {
    const r = await POST(req("{not json", {}));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid_json" });
  });
  it("empty body → 400 invalid_json", async () => {
    const r = await POST(req("", {}));
    expect(r.status).toBe(400);
  });
  it.each([["[]", "array"], ["42", "primitive"]])("%s (%s) → 400 invalid_request", async (raw) => {
    const r = await POST(req(raw, {}));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid_request" });
  });
  it("unknown key → 400 invalid_request (strict; no injected authority)", async () => {
    const r = await POST(req({ message: "hi", idempotencyKey: KEY, workspaceId: "evil" }));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid_request" });
    expect(runDurableTurn).not.toHaveBeenCalled();
  });
  it.each([
    ["missing key", { message: "hi" }],
    ["bad key", { message: "hi", idempotencyKey: "nope" }],
    ["missing message", { idempotencyKey: KEY }],
    ["whitespace message", { message: "   ", idempotencyKey: KEY }],
    ["bad threadId", { message: "hi", threadId: "nope", idempotencyKey: KEY }],
  ])("%s → 400", async (_label, body) => {
    const r = await POST(req(body));
    expect(r.status).toBe(400);
  });
  it("message over 20k chars → 400", async () => {
    const r = await POST(req({ message: "x".repeat(20_001), idempotencyKey: KEY }));
    expect(r.status).toBe(400);
  });
  it("valid minimal → 200 and provider constructed AFTER validation", async () => {
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }));
    expect(r.status).toBe(200);
    expect(createLLMProvider).toHaveBeenCalledTimes(1);
  });
  it("invalid request does NOT construct a provider", async () => {
    await POST(req({ idempotencyKey: KEY })); // missing message
    expect(createLLMProvider).not.toHaveBeenCalled();
  });
});

describe("POST /api/jarvis/chat — bounded body", () => {
  it("body over 128 KiB (with Content-Length) → 413 before running", async () => {
    const big = "x".repeat(200_000);
    const r = await POST(req(JSON.stringify({ message: big, idempotencyKey: KEY })));
    expect(r.status).toBe(413);
    expect(runDurableTurn).not.toHaveBeenCalled();
  });
  it("streamed body over 128 KiB WITHOUT Content-Length → 413 (incremental counter)", async () => {
    // No content-length is set for a stream body, so this exercises the streaming byte
    // counter path (not the early Content-Length reject). The route counts actual bytes
    // and returns 413 once the ceiling is crossed, then cancels the reader.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = new Uint8Array(64 * 1024); // 64 KiB chunks
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.enqueue(chunk); // 192 KiB total > 128 KiB
        controller.close();
      },
    });
    const request = new Request(`${APP}/api/jarvis/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      // @ts-expect-error Node fetch requires duplex for a stream body
      duplex: "half",
    });
    const r = await POST(request);
    expect(r.status).toBe(413);
    expect(runDurableTurn).not.toHaveBeenCalled();
  });
});

describe("POST /api/jarvis/chat — provider construction", () => {
  it("enabled + provider config failure → 503, runDurableTurn NOT called", async () => {
    vi.mocked(createLLMProvider).mockImplementation(() => {
      throw new Error("ANTHROPIC_API_KEY is not set");
    });
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "provider_unavailable" });
    expect(runDurableTurn).not.toHaveBeenCalled();
  });
});

describe("POST /api/jarvis/chat — delegation + DTO + headers", () => {
  it("passes ONLY message/threadId/idempotencyKey and a server resolveContext (no signal, no injected authority)", async () => {
    await POST(req({ message: "  hi  ", threadId: THREAD, idempotencyKey: KEY }));
    const [input, deps] = vi.mocked(runDurableTurn).mock.calls[0]!;
    expect(input).toEqual({ message: "hi", threadId: THREAD, idempotencyKey: KEY }); // trimmed; no workspaceId/userId/etc
    expect(Object.keys(input).sort()).toEqual(["idempotencyKey", "message", "threadId"]);
    expect(deps).toHaveProperty("provider");
    expect(deps).toHaveProperty("resolveContext");
    expect(deps).not.toHaveProperty("signal");
    await expect((deps as { resolveContext: () => Promise<unknown> }).resolveContext()).resolves.toEqual(CTX);
  });
  it("completed outcome → 200 DTO + Cache-Control no-store", async () => {
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ status: "completed", replay: false, requestId: "corr-1", threadId: THREAD, assistantMessage: "hi" });
  });
  it("conflict outcome → 409 no ids", async () => {
    vi.mocked(runDurableTurn).mockResolvedValue({ kind: "conflict" } as never);
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "idempotency_conflict" });
  });
  it("in_progress outcome → 202 processing", async () => {
    vi.mocked(runDurableTurn).mockResolvedValue({ kind: "in_progress", turnId: "t9" } as never);
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }));
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ status: "processing", turnId: "t9" });
  });
  it("failed_replay outcome → mapped provider status + no-store", async () => {
    vi.mocked(runDurableTurn).mockResolvedValue({ kind: "failed_replay", turnId: "tf", reason: "timeout" } as never);
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }));
    expect(r.status).toBe(504);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ error: "provider_timeout", replay: true, turnId: "tf" });
  });
  it("error responses also carry Cache-Control no-store", async () => {
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }, { origin: "https://evil.com" }));
    expect(r.status).toBe(403);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});

// A minimal Request-shaped fake giving full control of the body reader (read/cancel),
// so we can exercise the enabled-path exception boundary deterministically.
function fakeReq(reader: { read: () => Promise<{ done: boolean; value?: Uint8Array }>; cancel: () => Promise<void> }, headers: Record<string, string> = { "content-type": "application/json" }): Request {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null },
    body: { getReader: () => reader },
  } as unknown as Request;
}

describe("POST /api/jarvis/chat — bounded top-level exception boundary", () => {
  it("A. runDurableTurn throws → 500 internal_error + no-store, sensitive message NOT leaked", async () => {
    vi.mocked(runDurableTurn).mockRejectedValue(new Error("SENSITIVE claim failed: db=prod host=10.0.0.1 key=sk-abc"));
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }));
    expect(r.status).toBe(500);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const text = JSON.stringify(await r.json());
    expect(JSON.parse(text)).toEqual({ error: "internal_error" });
    for (const secret of ["SENSITIVE", "prod", "10.0.0.1", "sk-abc"]) expect(text).not.toContain(secret);
  });

  it("B. body reader read() throws → 500 internal_error + no-store, error not leaked", async () => {
    const reader = {
      read: async () => {
        throw new Error("read boom SENSITIVE-DB-DETAIL");
      },
      cancel: async () => {},
    };
    const r = await POST(fakeReq(reader));
    expect(r.status).toBe(500);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const text = JSON.stringify(await r.json());
    expect(JSON.parse(text)).toEqual({ error: "internal_error" });
    expect(text).not.toContain("SENSITIVE-DB-DETAIL");
    expect(runDurableTurn).not.toHaveBeenCalled();
  });

  it("C. body over ceiling AND reader.cancel() throws → still 413, no-store, cancel error not exposed", async () => {
    let served = false;
    const reader = {
      read: async () => {
        if (served) return { done: true, value: undefined };
        served = true;
        return { done: false, value: new Uint8Array(200_000) }; // > 128 KiB in one chunk
      },
      cancel: async () => {
        throw new Error("cancel boom SENSITIVE-CANCEL");
      },
    };
    const r = await POST(fakeReq(reader));
    expect(r.status).toBe(413);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const text = JSON.stringify(await r.json());
    expect(JSON.parse(text)).toEqual({ error: "payload_too_large" });
    expect(text).not.toContain("SENSITIVE-CANCEL");
    expect(runDurableTurn).not.toHaveBeenCalled();
  });
});

describe("POST /api/jarvis/chat — strict Content-Type", () => {
  it.each([
    ["application/json", 200],
    ["application/json; charset=utf-8", 200],
    ["Application/JSON; Charset=UTF-8", 200],
    ["application/json-patch+json", 415],
    ["application/problem+json", 415],
    ["xapplication/jsonx", 415],
    ["text/application/json", 415],
    ["text/json", 415],
    ["application/javascript", 415],
  ])("%s → %i", async (ct, status) => {
    const r = await POST(req({ message: "hi", idempotencyKey: KEY }, { "content-type": ct }));
    expect(r.status).toBe(status);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});
