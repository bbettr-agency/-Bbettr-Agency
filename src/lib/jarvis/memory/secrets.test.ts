import { describe, it, expect } from "vitest";
import { scanForSecrets, scanMemoryContent, redactIfSecret, REDACTED_SECRET_MARKER } from "./secrets";

/**
 * Secret-detection fixtures are FABRICATED and assembled at runtime from
 * fragments via `j(...)`, so no complete credential-shaped literal ever appears
 * in source (it would trip GitHub secret-scanning / push protection). The
 * detector still receives the full representative value at runtime, so detection
 * behaviour is unchanged. None of these are real credentials.
 */
const j = (...parts: string[]): string => parts.join("");

describe("secret guard — blocks high-confidence secret material", () => {
  const cases: Array<[string, string]> = [
    ["private key", j("-----BEGIN RSA ", "PRIVATE KEY", "-----\nMIIB...")],
    ["jwt / service-role", "token " + j("eyJhbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjMifQ", ".", "abcdefghij_klmno")],
    ["aws key", "key " + j("AKIA", "IOSFODNN7EXAMPLE") + " here"],
    ["google key", j("AIza", "SyA1234567890abcdefghijklmnopqrstuv")],
    ["slack token", j("xoxb", "-1234567890-", "abcdefghijklmno")],
    ["stripe key", j("sk", "_live_", "abcdefghijklmnop1234")],
    ["github pat", j("ghp", "_", "abcdefghijklmnopqrstuvwxyz0123")],
    ["openai-style sk", j("sk", "-abcdefghijklmnopqrstuvwx")],
    ["password assignment", "the password: " + j("hunter2", "supersecret")],
    ["api_key assignment", "api_key = " + j("ABCD1234", "EFGH5678")],
    ["card number (luhn)", "card 4242 4242 4242 4242 on file"],
    ["bank details", "FNB account number 62012345678, branch code 250655"],
  ];
  for (const [label, text] of cases) {
    it(`blocks: ${label}`, () => {
      const r = scanForSecrets(text);
      expect(r.blocked).toBe(true);
      expect(r.categories.length).toBeGreaterThan(0);
    });
  }

  it("declaredSecret is fail-closed (always blocked)", () => {
    const r = scanForSecrets("perfectly ordinary text", true);
    expect(r.blocked).toBe(true);
    expect(r.categories).toContain("declared_secret");
  });

  it("returns only SAFE category labels, never the secret content", () => {
    const value = j("ABCD1234", "EFGH5678");
    const r = scanForSecrets("api_key = " + value);
    expect(JSON.stringify(r)).not.toContain(value);
  });
});

describe("secret guard — does NOT falsely block ordinary business content", () => {
  const ok = [
    "Client prefers weekly check-ins on Mondays.",
    "We raised the retainer to R1500 in September 2026 after adding SEO.",
    "Decision: pause Meta ads until the new landing page ships.",
    "Order reference 4242424242424241 was cancelled.", // 16 digits but Luhn-invalid → not a card
    "Contact number 072 123 4567.",
  ];
  for (const text of ok) {
    it(`allows: ${text.slice(0, 32)}…`, () => {
      expect(scanForSecrets(text).blocked).toBe(false);
    });
  }
});

describe("scanMemoryContent — scans claim + body + structured", () => {
  it("blocks when a secret hides in the body", () => {
    const r = scanMemoryContent({ claim: "server access", body: "password: " + j("superSecret", "Value1") });
    expect(r.blocked).toBe(true);
  });
  it("blocks when a secret hides in structured JSON", () => {
    const r = scanMemoryContent({ claim: "config", structured: { token: j("sk", "_live_", "abcdefghijklmnop1234") } });
    expect(r.blocked).toBe(true);
  });
  it("passes clean content", () => {
    const r = scanMemoryContent({ claim: "Client likes concise updates", structured: { channel: "email" } });
    expect(r.blocked).toBe(false);
  });
});

// R3 / F-04 — read-time provider-context redaction helper.
describe("redactIfSecret (R3/F-04)", () => {
  const SK = j("sk-", "A1b2C3d4E5f6G7h8I9j0K1l2"); // OpenAI-style key (fabricated, not real)
  it("A1: a high-confidence secret value → exactly the marker", () => {
    expect(redactIfSecret(`please use ${SK} to call the API`)).toBe(REDACTED_SECRET_MARKER);
    expect(redactIfSecret(SK)).toBe(REDACTED_SECRET_MARKER);
  });
  it("A2: normal text unchanged", () => {
    const s = "Invoice the Fine Art client on the 28th; two tasks are unassigned.";
    expect(redactIfSecret(s)).toBe(s);
  });
  it("A3: benign UUID unchanged", () => {
    const u = "3e7cc8ae-ad72-4cf9-b051-1fa5a9ac70a4";
    expect(redactIfSecret(u)).toBe(u);
  });
  it("A4: benign phone number unchanged", () => {
    const p = "Call the client on +27 82 555 1234 tomorrow";
    expect(redactIfSecret(p)).toBe(p);
  });
  it("A5: benign invoice/tracking identifiers unchanged", () => {
    const s = "Invoice INV-2026-000915; tracking 1Z999AA10123456784; order #A1000042";
    expect(redactIfSecret(s)).toBe(s);
  });
  it("A6: never returns the secret literal", () => {
    expect(redactIfSecret(SK)).not.toContain(SK);
    expect(REDACTED_SECRET_MARKER).toBe("[REDACTED_SECRET]");
  });
});
