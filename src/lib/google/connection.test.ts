import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Replace the service-role client and the config so exchangeAndStore can run in
// isolation. The token endpoint is mocked via global.fetch below.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/google/config", () => ({
  getGoogleConfig: vi.fn(),
  GOOGLE_SCOPE: "openid email https://www.googleapis.com/auth/calendar.events",
  GOOGLE_TOKEN_URL: "https://oauth2.googleapis.com/token",
}));

import { exchangeAndStore } from "./connection";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGoogleConfig } from "@/lib/google/config";
import { IntegrationError } from "@/lib/net";

const CFG = {
  clientId: "cid",
  clientSecret: "csecret",
  redirectUri: "https://portal.example.com/api/google/callback",
  tokenSecret: "a-strong-token-secret",
  calendarId: "info@bbettragency.com",
  sendUpdates: "none" as const,
};

/** A fake service-role client whose upsert resolves to the given result. */
function adminReturning(upsertResult: { error: unknown }) {
  return {
    from: () => ({ upsert: () => Promise.resolve(upsertResult) }),
  } as unknown as ReturnType<typeof createAdminClient>;
}

const realFetch = global.fetch;

beforeEach(() => {
  vi.mocked(getGoogleConfig).mockReturnValue(CFG);
  // Google token endpoint → valid tokens (refresh token present, no id_token so
  // the account check passes without a wrong-account throw).
  global.fetch = vi.fn(async () =>
    new Response(
      JSON.stringify({ access_token: "at", expires_in: 3600, refresh_token: "rt" }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  ) as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("exchangeAndStore — credential persistence", () => {
  it("throws a sanitized typed error when the upsert fails (no silent success)", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      adminReturning({
        error: { code: "42P01", message: "relation \"calendar_credentials\" does not exist" },
      })
    );

    const promise = exchangeAndStore("auth-code", "00000000-0000-0000-0000-0000000000a1", "cid-1");

    // It must REJECT — the callback only redirects google=connected when this
    // resolves, so a failed write can never produce the success redirect.
    await expect(promise).rejects.toBeInstanceOf(IntegrationError);
    // Sanitized message: no raw DB error text, no token.
    await expect(
      exchangeAndStore("auth-code", "00000000-0000-0000-0000-0000000000a1", "cid-2")
    ).rejects.toThrowError("Failed to persist the Google credential.");
  });

  it("resolves only when the upsert succeeds", async () => {
    vi.mocked(createAdminClient).mockReturnValue(adminReturning({ error: null }));
    await expect(
      exchangeAndStore("auth-code", "00000000-0000-0000-0000-0000000000a1", "cid-3")
    ).resolves.toBeUndefined();
  });
});
