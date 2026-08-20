import { describe, it, expect } from "vitest";
import {
  adminNavSections,
  clientNavSections,
  PLANNER_SECTION,
  CLIENT_SECTIONS,
  REP_SECTIONS,
} from "./nav";
import { SECTION_HREF, NOTIFY_SECTIONS } from "@/lib/queries";

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

describe("IA Slice 1 — admin nav simplification", () => {
  it("demotes the agency-wide Reports/Updates/Files roll-ups out of primary nav", () => {
    const labels = adminNavSections(true)[0].items.map((i) => i.label);
    expect(labels).toEqual(["Overview", "Clients", "Reps", "Invoice Requests"]);
    for (const gone of ["Reports", "Updates", "Files"]) {
      expect(labels).not.toContain(gone);
    }
  });
});

describe("IA Slice 1 — client nav simplification", () => {
  const flat = (secs: import("./nav").NavSection[]) => secs.flatMap((s) => s.items);

  it("Onboarding shows only while active; never Project Progress; Home present", () => {
    const active = flat(clientNavSections({ onboardingActive: true })).map((i) => i.label);
    const done = flat(clientNavSections({ onboardingActive: false })).map((i) => i.label);
    expect(active).toContain("Home");
    expect(active).toContain("Onboarding");
    expect(done).not.toContain("Onboarding");
    expect(active).not.toContain("Project Progress");
    expect(active).not.toContain("Dashboard"); // renamed to Home
  });

  it("consolidates Reports/Invoices/Contracts/Files under a 'Documents & billing' group", () => {
    const secs = clientNavSections({ onboardingActive: true });
    const docs = secs.find((s) => s.label === "Documents & billing");
    expect(docs).toBeTruthy();
    expect(docs!.items.map((i) => i.label)).toEqual(["Reports", "Invoices", "Contracts", "Files"]);
    // Those routes are NOT top-level primary items any more.
    expect(secs[0].items.map((i) => i.label)).not.toContain("Reports");
  });

  it("preserves every client route (no capability lost) — /dashboard/project stays reachable via its route, not nav", () => {
    const hrefs = flat(clientNavSections({ onboardingActive: true })).map((i) => i.href);
    for (const href of [
      "/dashboard", "/dashboard/onboarding", "/dashboard/updates",
      "/dashboard/reports", "/dashboard/invoices", "/dashboard/contracts", "/dashboard/files",
    ]) {
      expect(hrefs).toContain(href);
    }
    // Project Progress is intentionally demoted from nav (route preserved separately).
    expect(hrefs).not.toContain("/dashboard/project");
  });
});

describe("IA Slice 1 — project notification rolls up to Home", () => {
  const clientHrefs = () =>
    new Set(
      clientNavSections({ onboardingActive: true }).flatMap((s) =>
        s.items.map((i) => i.href)
      )
    );
  const homeHref = () =>
    clientNavSections({ onboardingActive: true })[0].items.find(
      (i) => i.label === "Home"
    )!.href;

  it("keeps `project` as a notify section (seen-state key is unchanged)", () => {
    // The client_section_views key stays `project`; only its DISPLAY href moved.
    expect(NOTIFY_SECTIONS).toContain("project");
  });

  it("routes the project unread dot onto the Home nav item", () => {
    expect(SECTION_HREF.project).toBe("/dashboard");
    expect(SECTION_HREF.project).toBe(homeHref());
  });

  it("simulates the layout badge loop: an unread project surfaces a dot on Home", () => {
    const notifications: Record<(typeof NOTIFY_SECTIONS)[number], boolean> = {
      project: true,
      updates: false,
      reports: false,
      files: false,
      invoices: false,
    };
    const badges: Record<string, "dot" | undefined> = {};
    for (const section of NOTIFY_SECTIONS) {
      if (notifications[section]) badges[SECTION_HREF[section]] = "dot";
    }
    expect(badges[homeHref()]).toBe("dot");
  });

  it("no notification dot is orphaned — every notify href maps to a real client nav destination", () => {
    const hrefs = clientHrefs();
    for (const section of NOTIFY_SECTIONS) {
      expect(hrefs.has(SECTION_HREF[section])).toBe(true);
    }
  });
});
