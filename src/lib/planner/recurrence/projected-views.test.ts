import { describe, it, expect } from "vitest";
import { projectViewerOccurrences, type ViewerDefinitionRow, type ViewerProjectionContext } from "./projected-views";

const NAMES = new Map<string, string>([["owner-1", "Eloff"], ["ash", "Ashwin"]]);

function vdef(o: Partial<ViewerDefinitionRow> & { id: string; next_occurrence: string; rule_unit: ViewerDefinitionRow["rule_unit"] }): ViewerDefinitionRow {
  return {
    id: o.id,
    template_title: o.template_title ?? "Reminder",
    template_priority: o.template_priority ?? "normal",
    owner_user_id: o.owner_user_id ?? "owner-1",
    default_assignee_id: o.default_assignee_id ?? null,
    rule_unit: o.rule_unit,
    rule_interval: o.rule_interval ?? 1,
    anchor_day: o.anchor_day ?? (o.rule_unit === "month" ? Number(o.next_occurrence.slice(8, 10)) : null),
    next_occurrence: o.next_occurrence,
    due_offset_days: o.due_offset_days ?? 0,
    active: o.active ?? true,
  };
}

function ctx(defs: ViewerDefinitionRow[], materialised: string[] = []): ViewerProjectionContext {
  return { defs, materializedSlots: new Set(materialised) };
}

describe("projectViewerOccurrences — projection + dedupe + presentation", () => {
  it("builds a projected TaskView flagged isProjected with the recurrence identity + cadence", () => {
    const d = vdef({ id: "velmore", next_occurrence: "2026-09-28", rule_unit: "month", template_title: "Invoice Velmoré Hotel" });
    const views = projectViewerOccurrences(ctx([d]), "2026-09-28", "2026-09-28", NAMES);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      title: "Invoice Velmoré Hotel",
      isProjected: true,
      isRecurring: true,
      recurrenceDefinitionId: "velmore",
      occurrenceSlot: "2026-09-28",
      recurrenceLabel: "Monthly",
      scheduledDate: "2026-09-28",
      dueDate: "2026-09-28",
      aggregateVersion: 0,
      ownerDisplay: "Eloff",
      status: "scheduled",
    });
    expect(views[0].id).toBe("proj:velmore:2026-09-28");
  });

  it("DEDUPES a projected slot that is already materialised (no duplicate card)", () => {
    const d = vdef({ id: "velmore", next_occurrence: "2026-09-28", rule_unit: "month" });
    // 28 Sep already has a real task row ⇒ projector must not add it again.
    const views = projectViewerOccurrences(ctx([d], ["velmore:2026-09-28"]), "2026-09-28", "2026-09-28", NAMES);
    expect(views).toHaveLength(0);
  });

  it("daily inside the materialised window projects nothing (all deduped / watermark future)", () => {
    // QuickBooks created 29 Sep: watermark 14 Oct; 29 Sep..13 Oct materialised.
    const d = vdef({ id: "qb", next_occurrence: "2026-10-14", rule_unit: "day", template_title: "QuickBooks Daily Invoice Check" });
    const materialised = [];
    for (let i = 0; i <= 15; i++) materialised.push(`qb:${new Date(Date.UTC(2026, 8, 29 + i)).toISOString().slice(0, 10)}`);
    expect(projectViewerOccurrences(ctx([d], materialised), "2026-09-29", "2026-09-29", NAMES)).toHaveLength(0);
    // This Week horizon too.
    expect(projectViewerOccurrences(ctx([d], materialised), "2026-09-29", "2026-10-04", NAMES)).toHaveLength(0);
  });

  it("beyond the materialised horizon the daily occurrence is projected (no cliff)", () => {
    const d = vdef({ id: "qb", next_occurrence: "2026-10-14", rule_unit: "day" });
    const views = projectViewerOccurrences(ctx([d]), "2026-10-14", "2026-10-14", NAMES);
    expect(views.map((v) => v.occurrenceSlot)).toEqual(["2026-10-14"]);
  });

  it("This Week projects each in-week future occurrence of a definition", () => {
    const d = vdef({ id: "qb", next_occurrence: "2026-10-14", rule_unit: "day" });
    // Week Mon 12–Sun 18 Oct, today Wed 14: 14..18 Oct (none materialised here).
    const views = projectViewerOccurrences(ctx([d]), "2026-10-14", "2026-10-18", NAMES);
    expect(views.map((v) => v.occurrenceSlot)).toEqual(["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
  });

  it("projects across multiple definitions and honours per-definition dedupe", () => {
    const daily = vdef({ id: "qb", next_occurrence: "2026-10-14", rule_unit: "day" });
    const monthly = vdef({ id: "velmore", next_occurrence: "2026-09-28", rule_unit: "month" });
    const views = projectViewerOccurrences(ctx([daily, monthly], ["qb:2026-10-14"]), "2026-10-14", "2026-10-14", NAMES);
    // qb 14 Oct deduped; velmore 28 Sep surfaces as overdue recovery.
    expect(views.map((v) => `${v.recurrenceDefinitionId}:${v.occurrenceSlot}`)).toEqual(["velmore:2026-09-28"]);
    expect(views[0].isOverdue).toBe(true);
  });

  it("resolves the assignee display name when the definition is assigned", () => {
    const d = vdef({ id: "d", next_occurrence: "2026-10-14", rule_unit: "day", default_assignee_id: "ash" });
    const v = projectViewerOccurrences(ctx([d]), "2026-10-14", "2026-10-14", NAMES)[0];
    expect(v.assigneeDisplay).toBe("Ashwin");
  });

  it("inactive definitions contribute nothing", () => {
    const d = vdef({ id: "d", next_occurrence: "2026-10-14", rule_unit: "day", active: false });
    expect(projectViewerOccurrences(ctx([d]), "2026-10-14", "2026-10-14", NAMES)).toHaveLength(0);
  });
});
