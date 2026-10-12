import { describe, it, expect, vi, beforeEach } from "vitest";

// The tool lazily `await import("@/lib/planner/today/today-read-summary")`; mock it so no
// DB/auth is needed and we control the summary (and the unavailable path).
vi.mock("@/lib/planner/today/today-read-summary", () => ({ getTodayTaskSummary: vi.fn() }));

import { plannerTodayTool, plannerTodayUnavailable } from "./planner-today";
import { getTodayTaskSummary as getTodayTaskSummaryImpl } from "@/lib/planner/today/today-read-summary";
import type { RetrieverContext } from "../types";
import type { JarvisContext } from "@/lib/jarvis/identity";

const getTodayTaskSummary = vi.mocked(getTodayTaskSummaryImpl);

const NOW = new Date("2026-10-12T09:00:00Z");
const CTX = { principalId: "admin1", workspaceId: "w1", grants: new Set(["portal.read"]) } as JarvisContext;
const rc = { ctx: CTX, supabase: {}, now: () => NOW } as unknown as RetrieverContext;

beforeEach(() => getTodayTaskSummary.mockReset());

describe("portal_planner_today", () => {
  it("takes no arguments", () => {
    expect(plannerTodayTool.parse({}).ok).toBe(true);
    expect(plannerTodayTool.parse(undefined).ok).toBe(true);
    expect(plannerTodayTool.parse({ foo: 1 }).ok).toBe(false);
  });

  it("returns the authoritative counts AND the actual outstanding task titles (full coverage)", async () => {
    getTodayTaskSummary.mockResolvedValue({
      today: "2026-10-12",
      totalActionable: 12,
      completed: 7,
      remaining: 5,
      overdue: 0,
      waiting: 0,
      remainingTasks: [
        { id: "t1", title: "Cuisine Foods website finish before thu", scheduledDate: "2026-10-12", dueDate: null, isOverdue: false },
        { id: "t2", title: "Jan frits bel", scheduledDate: "2026-10-12", dueDate: null, isOverdue: false },
      ],
    });
    const r = await plannerTodayTool.run({}, rc, CTX);
    expect(getTodayTaskSummary).toHaveBeenCalledWith(NOW, "admin1"); // viewer = principal
    expect(r.total).toBe(12);
    expect(r.coverage).toBe("full");
    expect(r.content).toContain("12 total in Today (7 completed, 5 remaining)");
    expect(r.content).toContain("0 overdue");
    expect(r.content).toContain("Cuisine Foods website finish before thu [id: t1");
    expect(r.content).toContain("Jan frits bel");
    expect(r.content).toContain("Africa/Johannesburg");
    expect(r.content).toMatch(/Scope checked/);
  });

  it("UNAVAILABLE result (tasks source failure) maps to unavailable coverage and NEVER asserts absence", () => {
    // The catch-path builder is pure; test it directly (deterministic, no dynamic-import throw).
    const r = plannerTodayUnavailable("TasksDisabled");
    expect(r.coverage).toBe("unavailable");
    expect(r.degraded).toBe(true);
    expect(r.total).toBeNull();
    expect(r.content).toMatch(/could not be checked/i);
    expect(r.content).toMatch(/Do NOT state there are no tasks/);
    expect(r.content).toMatch(/NOT verified/);
    // It must NOT itself report a zero count that could be read as "nothing to do".
    expect(r.content).not.toMatch(/\b0 (total|remaining|completed)\b/);
  });

  it("requires the portal.read grant and is agency-scoped in the registry", () => {
    expect(plannerTodayTool.requiredGrant).toBe("portal.read");
    expect(plannerTodayTool.name).toBe("portal_planner_today");
  });
});
