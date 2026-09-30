import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

// Capture ledger updates from the route.
type Update = { table: string; patch: Record<string, unknown>; filters: [string, unknown][] };
let updates: Update[] = [];

function fakeAdmin() {
  return {
    from(table: string) {
      const rec: Update = { table, patch: {}, filters: [] };
      const builder = {
        update(patch: Record<string, unknown>) {
          rec.patch = patch;
          return builder;
        },
        eq(col: string, val: unknown) {
          rec.filters.push([col, val]);
          return builder;
        },
        then<T>(resolve: (v: { data: null; error: null }) => T) {
          updates.push(rec);
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeAdmin() }));

import { POST } from "./route";

const SECRET = "whsec_dGVzdHNlY3JldHNlY3JldA=="; // base64("testsecretsecret")

function signedRequest(body: string, secret = SECRET, at = Date.now()): Request {
  const id = "msg_evt_1";
  const timestamp = String(Math.floor(at / 1000));
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = crypto.createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${body}`).digest("base64");
  return new Request("https://portal.bbettragency.com/api/email/resend-webhook", {
    method: "POST",
    headers: {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${sig}`,
      "content-type": "application/json",
    },
    body,
  });
}

beforeEach(() => {
  updates = [];
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
});

describe("resend webhook", () => {
  it("maps a delivered event to a 'delivered' ledger update keyed by message id", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "msg_123" } });
    const res = await POST(signedRequest(body));
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].patch.status).toBe("delivered");
    expect(updates[0].filters).toContainEqual(["resend_message_id", "msg_123"]);
  });

  it("maps a bounced event to a 'bounced' ledger update", async () => {
    const body = JSON.stringify({ type: "email.bounced", data: { email_id: "msg_9" } });
    await POST(signedRequest(body));
    expect(updates[0].patch.status).toBe("bounced");
  });

  it("promotes queued → sent only (guarded) on email.sent", async () => {
    const body = JSON.stringify({ type: "email.sent", data: { email_id: "msg_5" } });
    await POST(signedRequest(body));
    expect(updates[0].patch.status).toBe("sent");
    expect(updates[0].filters).toContainEqual(["status", "queued"]);
  });

  it("rejects an invalid signature with 400 and writes nothing", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "msg_123" } });
    const req = signedRequest(body, "whsec_d3JvbmdzZWNyZXR3cm9uZw=="); // signed with a different secret
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  it("ignores unknown event types (no ledger write)", async () => {
    const body = JSON.stringify({ type: "email.opened", data: { email_id: "msg_123" } });
    const res = await POST(signedRequest(body));
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
  });

  it("accept-and-ignores when no webhook secret is configured", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "msg_123" } });
    const res = await POST(signedRequest(body));
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
  });
});
