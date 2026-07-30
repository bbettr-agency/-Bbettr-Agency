import { describe, it, expect } from "vitest";
import { encodeBase32hex, googleEventId, meetRequestId } from "./event-id";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const GOOGLE_ID_CHARSET = /^[0-9a-v]+$/; // Google's allowed event-id charset

describe("encodeBase32hex", () => {
  it("encodes to the base32hex alphabet only", () => {
    const out = encodeBase32hex(new Uint8Array([0, 1, 2, 3, 255, 128, 64]));
    expect(out).toMatch(GOOGLE_ID_CHARSET);
  });
  it("encodes 20 bytes to exactly 32 chars (no padding)", () => {
    expect(encodeBase32hex(new Uint8Array(20)).length).toBe(32);
  });
});

describe("googleEventId", () => {
  it("is deterministic for the same entity + epoch", () => {
    expect(googleEventId(UUID, 0)).toBe(googleEventId(UUID, 0));
  });

  it("only ever uses Google's allowed charset and length", () => {
    const id = googleEventId(UUID, 0);
    expect(id).toMatch(GOOGLE_ID_CHARSET);
    expect(id.length).toBe(32);
    expect(id.length).toBeGreaterThanOrEqual(5);
    expect(id.length).toBeLessThanOrEqual(1024);
  });

  it("changes when the epoch advances (fresh id namespace on rebuild)", () => {
    expect(googleEventId(UUID, 0)).not.toBe(googleEventId(UUID, 1));
  });

  it("differs across entities", () => {
    const other = "00000000-0000-0000-0000-000000000001";
    expect(googleEventId(UUID, 0)).not.toBe(googleEventId(other, 0));
  });

  it("accepts uppercase UUIDs (normalises)", () => {
    expect(googleEventId(UUID.toUpperCase(), 0)).toBe(googleEventId(UUID, 0));
  });

  it("rejects non-UUID input", () => {
    expect(() => googleEventId("not-a-uuid", 0)).toThrow();
  });

  it("rejects out-of-range epochs", () => {
    expect(() => googleEventId(UUID, -1)).toThrow();
    expect(() => googleEventId(UUID, 0x1_0000_0000)).toThrow();
  });
});

describe("meetRequestId", () => {
  it("is deterministic and epoch-sensitive", () => {
    expect(meetRequestId(UUID, 0)).toBe(meetRequestId(UUID, 0));
    expect(meetRequestId(UUID, 0)).not.toBe(meetRequestId(UUID, 1));
  });
});
