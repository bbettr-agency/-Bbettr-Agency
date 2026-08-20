import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * IA Slice 1 is navigation-only: it demotes several destinations out of primary
 * nav but MUST NOT delete any route. This guard fails CI if a page that Slice 1
 * relies on staying reachable (by bookmark, deep-link, or notification target)
 * is ever removed. vitest runs from the repo root, so cwd is the project root.
 */
const root = process.cwd();
const exists = (p: string) => existsSync(join(root, p));
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("IA Slice 1 — route preservation (no route deleted)", () => {
  const CLIENT_ROUTES = [
    "src/app/(client)/dashboard/page.tsx",
    "src/app/(client)/dashboard/project/page.tsx", // demoted from nav, deep-link kept
    "src/app/(client)/dashboard/onboarding/page.tsx",
    "src/app/(client)/dashboard/updates/page.tsx",
    "src/app/(client)/dashboard/reports/page.tsx",
    "src/app/(client)/dashboard/invoices/page.tsx",
    "src/app/(client)/dashboard/contracts/page.tsx",
    "src/app/(client)/dashboard/files/page.tsx",
  ];
  const ADMIN_DEMOTED_ROUTES = [
    "src/app/(admin)/admin/reports/page.tsx",
    "src/app/(admin)/admin/updates/page.tsx",
    "src/app/(admin)/admin/files/page.tsx",
  ];

  it("keeps every client portal route reachable", () => {
    for (const r of CLIENT_ROUTES) expect(exists(r), r).toBe(true);
  });

  it("keeps the demoted agency-wide admin roll-up routes reachable (bookmarks)", () => {
    for (const r of ADMIN_DEMOTED_ROUTES) expect(exists(r), r).toBe(true);
  });

  it("keeps /dashboard/project clearing the project seen-state (deep-link parity)", () => {
    const src = read("src/app/(client)/dashboard/project/page.tsx");
    expect(src).toContain('SeenMarker section="project"');
  });

  it("also clears the project seen-state on Home (dot now rolls up to Home)", () => {
    const src = read("src/app/(client)/dashboard/page.tsx");
    expect(src).toContain('SeenMarker section="project"');
  });

  it("keeps the stage_advanced notification deep-link pointing at /dashboard/project", () => {
    const src = read("src/components/client/notification-bell.tsx");
    expect(src).toContain('stage_advanced: "/dashboard/project"');
  });
});
