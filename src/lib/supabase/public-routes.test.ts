import { describe, it, expect } from "vitest";
import { isPublicRoute } from "./public-routes";

describe("isPublicRoute (middleware auth surface)", () => {
  it("opens the public /reschedule route (token-authorized, no session)", () => {
    expect(isPublicRoute("/reschedule/AbC123")).toBe(true);
    expect(isPublicRoute("/reschedule")).toBe(true);
  });

  it("keeps every protected portal area gated", () => {
    for (const p of [
      "/",
      "/admin",
      "/admin/planner/meetings",
      "/dashboard",
      "/dashboard/updates",
      "/rep",
      "/rep/deals",
      "/api/google/callback",
    ]) {
      expect(isPublicRoute(p)).toBe(false);
    }
  });

  it("still allows the pre-existing public routes (no regression)", () => {
    expect(isPublicRoute("/login")).toBe(true);
    expect(isPublicRoute("/pay/abc")).toBe(true);
    expect(isPublicRoute("/api/payfast/itn")).toBe(true);
  });

  it("opens the public legal pages (Google OAuth Privacy/Terms URLs)", () => {
    expect(isPublicRoute("/privacy")).toBe(true);
    expect(isPublicRoute("/terms")).toBe(true);
    // Protected areas that merely contain the words stay gated (prefix match).
    expect(isPublicRoute("/admin/terms")).toBe(false);
  });

  it("does not open a lookalike that merely contains 'reschedule' lower in the path", () => {
    expect(isPublicRoute("/admin/reschedule")).toBe(false); // prefix match only
  });
});
