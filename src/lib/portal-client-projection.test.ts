import { describe, it, expect } from "vitest";
import { PORTAL_CLIENT_COLUMNS } from "./queries";

const cols = PORTAL_CLIENT_COLUMNS.split(",").map((s) => s.trim());

describe("PORTAL_CLIENT_COLUMNS — client-safe Home projection (Slice 2D regression)", () => {
  it("includes BOTH website URL fields (the reported bug: omitted from the client read)", () => {
    expect(cols).toContain("website_preview_url");
    expect(cols).toContain("website_live_url");
  });

  it("includes exactly the fields the Home page needs — nothing more", () => {
    expect(new Set(cols)).toEqual(
      new Set([
        "id",
        "name",
        "onboarding_type",
        "intake_status",
        "estimated_launch_date",
        "success_manager_id",
        "website_preview_url",
        "website_live_url",
      ])
    );
  });

  it("does NOT expose unrelated privileged client fields to the portal", () => {
    for (const privileged of [
      "notes",
      "contact_email",
      "contact_phone",
      "contact_name",
      "company",
      "logo_url",
      "status",
      "portal_access_granted_at",
      "portal_access_granted_by",
      "welcome_email_sent_at",
    ]) {
      expect(cols).not.toContain(privileged);
    }
  });
});
