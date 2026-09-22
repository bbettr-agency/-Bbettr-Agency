import { describe, it, expect } from "vitest";
import { canonicalProjectState, stageProgressPercent, type ProjectStageInput } from "./project-state";
import { SAFE_STAGE_LABEL } from "./journey";

type S = ProjectStageInput;
const stage = (name: string, status: string, position: number, target_date: string | null = null): S => ({
  name,
  status,
  position,
  target_date,
});

// The default 6-stage roadmap in internal names, in order.
const DEFAULT = [
  "Contract Signed",
  "Onboarding Submitted",
  "Assets Received",
  "In Development",
  "Review Stage",
  "Launch",
];
function roadmap(statuses: string[], dates: (string | null)[] = []): S[] {
  return DEFAULT.map((name, i) => stage(name, statuses[i] ?? "pending", i + 1, dates[i] ?? null));
}

describe("stageProgressPercent — deterministic completed/total (no half-credit)", () => {
  it("is 0 with no stages", () => expect(stageProgressPercent([])).toBe(0));
  it("counts ONLY completed stages", () => {
    // 2 completed, 1 in_progress, 3 pending → 2/6 = 33% (NOT 42% from half-credit).
    expect(stageProgressPercent(roadmap(["completed", "completed", "in_progress", "pending", "pending", "pending"]))).toBe(33);
  });
  it("is deterministic and ignores in_progress for the number", () => {
    expect(stageProgressPercent(roadmap(["completed", "in_progress", "pending", "pending", "pending", "pending"]))).toBe(17); // 1/6
    expect(stageProgressPercent(roadmap(["completed", "completed", "completed", "completed", "completed", "completed"]))).toBe(100);
  });
});

describe("canonicalProjectState", () => {
  it("no stages → empty/no_project state", () => {
    const p = canonicalProjectState([], { estimatedLaunchDate: "2026-12-01" });
    expect(p).toMatchObject({
      hasStages: false,
      totalStages: 0,
      completedStages: 0,
      progressPercent: 0,
      currentPosition: null,
      current: null,
      next: null,
      allComplete: false,
      launched: false,
      lifecycle: "no_project",
      estimatedLaunchDate: "2026-12-01",
      currentStageTargetDate: null,
    });
  });

  it("all pending → current is the first stage, 0% , not_started", () => {
    const p = canonicalProjectState(roadmap(["pending", "pending", "pending", "pending", "pending", "pending"]));
    expect(p.currentPosition).toBe(1);
    expect(p.current?.internalName).toBe("Contract Signed");
    expect(p.current?.label).toBe("Discovery");
    expect(p.next?.internalName).toBe("Onboarding Submitted");
    expect(p.progressPercent).toBe(0);
    expect(p.lifecycle).toBe("not_started");
  });

  it("first stage active", () => {
    const p = canonicalProjectState(roadmap(["in_progress", "pending", "pending", "pending", "pending", "pending"]));
    expect(p.currentPosition).toBe(1);
    expect(p.current?.internalName).toBe("Contract Signed");
    expect(p.completedStages).toBe(0);
    expect(p.progressPercent).toBe(0);
    expect(p.lifecycle).toBe("in_progress");
  });

  it("middle stage active → correct current/next/position/progress", () => {
    const p = canonicalProjectState(roadmap(["completed", "completed", "completed", "in_progress", "pending", "pending"]));
    expect(p.currentPosition).toBe(4);
    expect(p.current?.internalName).toBe("In Development");
    expect(p.current?.label).toBe("Development");
    expect(p.next?.internalName).toBe("Review Stage");
    expect(p.completedStages).toBe(3);
    expect(p.progressPercent).toBe(50); // 3/6
    expect(p.launched).toBe(false);
  });

  it("multiple incorrectly-active stages → first in_progress by position is current; progress still counts only completed", () => {
    const p = canonicalProjectState(roadmap(["completed", "in_progress", "in_progress", "pending", "pending", "pending"]));
    expect(p.current?.internalName).toBe("Onboarding Submitted"); // first in_progress by position
    expect(p.currentPosition).toBe(2);
    // Next = first non-completed AFTER the current one. Position 3 (Assets Received)
    // is itself in_progress and therefore non-completed, so it is the next milestone.
    expect(p.next?.internalName).toBe("Assets Received");
    expect(p.progressPercent).toBe(17); // only 1 completed → 1/6
  });

  it("completed stage after a pending one → progress counts all completed regardless of order", () => {
    // Messy: pending at pos1, completed at pos2. completed=1 → 17%.
    const p = canonicalProjectState([stage("Contract Signed", "pending", 1), stage("Onboarding Submitted", "completed", 2)]);
    expect(p.completedStages).toBe(1);
    expect(p.progressPercent).toBe(50); // 1/2
    expect(p.current?.internalName).toBe("Contract Signed"); // first non-completed (pending)
  });

  it("all completed → allComplete, 100%, launched, current is the last stage", () => {
    const p = canonicalProjectState(roadmap(["completed", "completed", "completed", "completed", "completed", "completed"]));
    expect(p.allComplete).toBe(true);
    expect(p.progressPercent).toBe(100);
    expect(p.launched).toBe(true); // Launch stage completed
    expect(p.lifecycle).toBe("launched");
    expect(p.currentPosition).toBe(6);
    expect(p.next).toBeNull();
  });

  it("Review Stage active → lifecycle in_review", () => {
    const p = canonicalProjectState(roadmap(["completed", "completed", "completed", "completed", "in_progress", "pending"]));
    expect(p.current?.internalName).toBe("Review Stage");
    expect(p.lifecycle).toBe("in_review");
    expect(p.launched).toBe(false);
  });

  it("unknown/internal stage names never leak — safe client label; admin keeps internal name", () => {
    const p = canonicalProjectState([stage("Secret Internal Phase", "in_progress", 1)]);
    expect(p.current?.internalName).toBe("Secret Internal Phase"); // admin-side
    expect(p.current?.label).toBe(SAFE_STAGE_LABEL); // client never sees the raw name
    expect(p.stages[0].label).toBe(SAFE_STAGE_LABEL);
  });

  it("target dates: current stage target is exposed; NEVER falls back to launch date", () => {
    const p = canonicalProjectState(
      roadmap(
        ["completed", "completed", "completed", "in_progress", "pending", "pending"],
        [null, null, null, "2026-10-15", null, null]
      ),
      { estimatedLaunchDate: "2026-12-01" }
    );
    expect(p.currentStageTargetDate).toBe("2026-10-15");
    expect(p.estimatedLaunchDate).toBe("2026-12-01");
  });

  it("no current-stage target → currentStageTargetDate is null (estimated launch stays separate)", () => {
    const p = canonicalProjectState(
      roadmap(["completed", "in_progress", "pending", "pending", "pending", "pending"]),
      { estimatedLaunchDate: "2026-12-01" }
    );
    expect(p.currentStageTargetDate).toBeNull(); // NOT the launch date
    expect(p.estimatedLaunchDate).toBe("2026-12-01");
  });

  it("launched flag is driven ONLY by the Launch stage being completed", () => {
    // Everything done except Launch still in progress → not launched.
    const notYet = canonicalProjectState(roadmap(["completed", "completed", "completed", "completed", "completed", "in_progress"]));
    expect(notYet.launched).toBe(false);
    expect(notYet.lifecycle).toBe("in_progress");
    const done = canonicalProjectState(roadmap(["completed", "completed", "completed", "completed", "completed", "completed"]));
    expect(done.launched).toBe(true);
  });
});
