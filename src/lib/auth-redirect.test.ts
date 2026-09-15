import { describe, it, expect } from "vitest";
import { safeNextPath } from "./auth-redirect";

describe("safeNextPath — open-redirect protection", () => {
  it("allows same-origin absolute paths", () => {
    expect(safeNextPath("/reset-password")).toBe("/reset-password");
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/admin/clients?tab=x")).toBe("/admin/clients?tab=x");
  });
  it("falls back for absolute URLs / protocol-relative / backslash / scheme tricks", () => {
    for (const bad of [
      "https://evil.com",
      "http://evil.com",
      "//evil.com",
      "/\\evil.com",
      "javascript:alert(1)",
      "/x:evil",
      "mailto:x@y.z",
    ]) {
      expect(safeNextPath(bad)).toBe("/reset-password");
    }
  });
  it("falls back for empty / non-string", () => {
    expect(safeNextPath(null)).toBe("/reset-password");
    expect(safeNextPath(undefined)).toBe("/reset-password");
    expect(safeNextPath("")).toBe("/reset-password");
  });
  it("honours a custom fallback", () => {
    expect(safeNextPath("//evil", "/login")).toBe("/login");
  });
});
