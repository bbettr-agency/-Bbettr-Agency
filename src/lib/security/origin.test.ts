import { describe, it, expect } from "vitest";
import { isBadOrigin, trustedOrigins } from "./origin";

const PROD = "https://portal.bbettragency.com";
const PREVIEW_HOST = "bbettr-portal-abc123-bbettr.vercel.app";
const BRANCH_HOST = "bbettr-portal-git-feature-bbettr.vercel.app";

function req(headers: Record<string, string>): Request {
  return new Request("https://example.test/api/jarvis/chat", { method: "POST", headers });
}

describe("trustedOrigins — derived only from platform metadata", () => {
  it("includes the canonical production origin and Vercel deployment metadata", () => {
    const t = trustedOrigins({
      NEXT_PUBLIC_APP_URL: PROD,
      VERCEL_URL: PREVIEW_HOST,
      VERCEL_BRANCH_URL: BRANCH_HOST,
      VERCEL_PROJECT_PRODUCTION_URL: "portal.bbettragency.com",
    });
    expect(t).toContain(PROD);
    expect(t).toContain(`https://${PREVIEW_HOST}`);
    expect(t).toContain(`https://${BRANCH_HOST}`);
  });
  it("ignores malformed values and dedupes", () => {
    expect(trustedOrigins({ NEXT_PUBLIC_APP_URL: "::::", VERCEL_URL: PREVIEW_HOST })).toEqual([`https://${PREVIEW_HOST}`]);
  });
});

describe("isBadOrigin — Production", () => {
  const env = { NEXT_PUBLIC_APP_URL: PROD };
  it("accepts the canonical production origin", () => {
    expect(isBadOrigin(req({ origin: PROD, "sec-fetch-site": "same-origin" }), env)).toBe(false);
  });
  it("rejects a wrong external production origin", () => {
    expect(isBadOrigin(req({ origin: "https://evil.com" }), env)).toBe(true);
  });
  it("rejects a cross-site Sec-Fetch-Site even with a valid Origin", () => {
    expect(isBadOrigin(req({ origin: PROD, "sec-fetch-site": "cross-site" }), env)).toBe(true);
  });
});

describe("isBadOrigin — Vercel Preview (no manual NEXT_PUBLIC_APP_URL)", () => {
  // Preview: NEXT_PUBLIC_APP_URL is the canonical PROD url; the Preview trusts its
  // OWN origin via Vercel-injected VERCEL_URL / VERCEL_BRANCH_URL.
  const env = { NEXT_PUBLIC_APP_URL: PROD, VERCEL_URL: PREVIEW_HOST, VERCEL_BRANCH_URL: BRANCH_HOST };

  it("accepts the current Preview deployment's own same-origin request", () => {
    expect(isBadOrigin(req({ origin: `https://${PREVIEW_HOST}`, "sec-fetch-site": "same-origin" }), env)).toBe(false);
  });
  it("accepts the Preview branch-alias origin", () => {
    expect(isBadOrigin(req({ origin: `https://${BRANCH_HOST}`, "sec-fetch-site": "same-origin" }), env)).toBe(false);
  });
  it("still accepts the canonical production origin", () => {
    expect(isBadOrigin(req({ origin: PROD }), env)).toBe(false);
  });
  it("rejects a DIFFERENT/random Vercel deployment origin", () => {
    expect(isBadOrigin(req({ origin: "https://some-other-deploy-xyz.vercel.app" }), env)).toBe(true);
  });
});

describe("isBadOrigin — missing/malformed Origin policy (unchanged)", () => {
  const env = { NEXT_PUBLIC_APP_URL: PROD };
  it("no Origin header → NOT rejected (falls through to session auth)", () => {
    expect(isBadOrigin(req({}), env)).toBe(false);
  });
  it("Sec-Fetch-Site 'none' with no Origin → NOT rejected", () => {
    expect(isBadOrigin(req({ "sec-fetch-site": "none" }), env)).toBe(false);
  });
  it("Origin present but NO trusted origin resolvable → fails CLOSED", () => {
    expect(isBadOrigin(req({ origin: PROD }), {})).toBe(true);
  });
});

describe("isBadOrigin — spoofed forwarding headers cannot bypass", () => {
  it("a spoofed Host / X-Forwarded-Host does NOT add trust", () => {
    // No VERCEL_URL in env; attacker sets forwarding headers + matching Origin.
    const env = { NEXT_PUBLIC_APP_URL: PROD };
    const r = req({ origin: `https://${PREVIEW_HOST}`, host: PREVIEW_HOST, "x-forwarded-host": PREVIEW_HOST });
    expect(isBadOrigin(r, env)).toBe(true); // forwarding headers ignored; origin not trusted
  });
  it("Host header is never used as the trust source (prod origin still required)", () => {
    const env = { NEXT_PUBLIC_APP_URL: PROD };
    // Valid prod Origin but attacker Host → still accepted on Origin (host ignored).
    expect(isBadOrigin(req({ origin: PROD, host: "evil.com", "x-forwarded-host": "evil.com" }), env)).toBe(false);
    // Attacker Origin with spoofed Host → rejected (host cannot grant trust).
    expect(isBadOrigin(req({ origin: "https://evil.com", host: "portal.bbettragency.com" }), env)).toBe(true);
  });
});
