import { describe, it, expect } from "vitest";
import {
  adminNavSections,
  PLANNER_SECTION,
  CLIENT_SECTIONS,
  REP_SECTIONS,
} from "./nav";

describe("adminNavSections", () => {
  it("includes the Planner section ONLY when the capability is enabled", () => {
    const enabled = adminNavSections(true);
    const disabled = adminNavSections(false);
    expect(enabled).toContain(PLANNER_SECTION);
    expect(disabled).not.toContain(PLANNER_SECTION);
    // main → Planner → tail when on; main → tail when off.
    expect(enabled).toHaveLength(3);
    expect(disabled).toHaveLength(2);
  });

  it("orders the Planner sub-menu exactly as specified", () => {
    expect(PLANNER_SECTION.label).toBe("Planner");
    expect(PLANNER_SECTION.items.map((i) => i.label)).toEqual([
      "Overview",
      "Today",
      "This Week",
      "Calendar",
      "My Tasks",
      "Team View",
      "Weekly Updates",
      "Recurring Reminders",
      "Inbox",
    ]);
    expect(PLANNER_SECTION.items[0].href).toBe("/admin/planner");
  });
});

describe("client / rep navigation", () => {
  it("never contains a Planner section", () => {
    expect(CLIENT_SECTIONS.some((s) => s.label === "Planner")).toBe(false);
    expect(REP_SECTIONS.some((s) => s.label === "Planner")).toBe(false);
    // And no client/rep item points at a Planner route.
    const hrefs = [...CLIENT_SECTIONS, ...REP_SECTIONS].flatMap((s) =>
      s.items.map((i) => i.href)
    );
    expect(hrefs.some((h) => h.startsWith("/admin/planner"))).toBe(false);
  });
});
