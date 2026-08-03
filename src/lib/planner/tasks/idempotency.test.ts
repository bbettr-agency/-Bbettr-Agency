import { describe, it, expect } from "vitest";
import { newIdempotencyKey } from "./idempotency";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("idempotency — newIdempotencyKey", () => {
  it("generates a valid v4 UUID", () => {
    expect(newIdempotencyKey()).toMatch(UUID);
  });
  it("generates a fresh, unique key per call (a new intent gets a new key)", () => {
    const keys = new Set(Array.from({ length: 500 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(500);
  });
  it("does not derive the key from any task content (takes no arguments)", () => {
    expect(newIdempotencyKey.length).toBe(0);
  });
});
