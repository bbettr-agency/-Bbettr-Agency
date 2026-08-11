import { describe, it, expect } from "vitest";
import { computeWeekly, totalItems, INTERNAL_CLIENT_LABEL, type WeeklyUpdateItem } from "./weekly-board";

let seq = 0;
function item(o: Partial<WeeklyUpdateItem> = {}): WeeklyUpdateItem {
  seq += 1;
  return {
    id: o.id ?? `i${seq}`,
    source: o.source ?? "task",
    text: o.text ?? "Did a thing",
    memberId: o.memberId ?? "eloff",
    memberName: o.memberName ?? "Eloff",
    clientId: o.clientId ?? null,
    clientName: o.clientName ?? null,
    dateLabel: o.dateLabel ?? "Tue 12 Aug",
    sortAt: o.sortAt ?? "2026-08-12T10:00:00Z",
    canDelete: o.canDelete ?? false,
  };
}
const all = { memberId: "all" as const, search: "" };

describe("computeWeekly", () => {
  it("groups by member; members sort by most-completed first, then name", () => {
    const groups = computeWeekly(
      [
        item({ memberId: "ashwin", memberName: "Ashwin" }),
        item({ memberId: "eloff", memberName: "Eloff" }),
        item({ memberId: "eloff", memberName: "Eloff" }),
      ],
      all
    );
    expect(groups.map((g) => `${g.memberName}:${g.count}`)).toEqual(["Eloff:2", "Ashwin:1"]);
  });

  it("merges task + manual under the same member, preserving source", () => {
    const groups = computeWeekly(
      [item({ memberId: "eloff", source: "task", text: "Velmore homepage" }), item({ memberId: "eloff", source: "manual", text: "Cuisine targeting" })],
      all
    );
    expect(groups).toHaveLength(1);
    expect(new Set(groups[0].items.map((i) => i.source))).toEqual(new Set(["task", "manual"]));
  });

  it("within a member: newest first (by sortAt), deterministic tie-break by source then id", () => {
    const groups = computeWeekly(
      [
        item({ id: "old", memberId: "e", sortAt: "2026-08-10T09:00:00Z" }),
        item({ id: "new", memberId: "e", sortAt: "2026-08-14T09:00:00Z" }),
        item({ id: "tie-b", memberId: "e", source: "task", sortAt: "2026-08-12T09:00:00Z" }),
        item({ id: "tie-a", memberId: "e", source: "manual", sortAt: "2026-08-12T09:00:00Z" }),
      ],
      all
    );
    // new (14th), then the 12th tie (manual < task), then old (10th)
    expect(groups[0].items.map((i) => i.id)).toEqual(["new", "tie-a", "tie-b", "old"]);
  });

  it("member filter keeps only that member", () => {
    const groups = computeWeekly([item({ memberId: "eloff" }), item({ memberId: "ashwin" })], { memberId: "ashwin", search: "" });
    expect(groups.map((g) => g.memberId)).toEqual(["ashwin"]);
  });

  it("search matches text OR client name, case-insensitively", () => {
    const groups = computeWeekly(
      [item({ id: "a", text: "MacBuild ads", clientName: "MacBuild" }), item({ id: "b", text: "QA", clientName: "Velmore" })],
      { memberId: "all", search: "velmore" }
    );
    expect(groups.flatMap((g) => g.items).map((i) => i.id)).toEqual(["b"]);
  });

  it("search matches the Internal label for null-client items", () => {
    const groups = computeWeekly([item({ id: "int", clientName: null })], { memberId: "all", search: "internal" });
    expect(groups.flatMap((g) => g.items).map((i) => i.id)).toEqual(["int"]);
    expect(INTERNAL_CLIENT_LABEL).toBe("Internal / No client");
  });

  it("totalItems sums across groups", () => {
    const groups = computeWeekly([item({ memberId: "e" }), item({ memberId: "a" }), item({ memberId: "e" })], all);
    expect(totalItems(groups)).toBe(3);
  });

  it("empty input → no groups", () => {
    expect(computeWeekly([], all)).toEqual([]);
  });
});
