import { describe, it, expect } from "vitest";
import { buildMemberDetail, type CompletedFacet } from "./team-detail";
import { INTERNAL_CLIENT_LABEL, type ActiveTaskStatus, type TeamTaskFacet } from "./team-board";

let seq = 0;
function facet(o: Partial<TeamTaskFacet> = {}): TeamTaskFacet {
  seq += 1;
  const status: ActiveTaskStatus = o.status ?? "planned";
  return {
    id: o.id ?? `t${seq}`,
    title: o.title ?? "Task",
    status,
    priority: o.priority ?? "normal",
    memberId: o.memberId ?? "m1",
    memberName: o.memberName ?? "Eloff",
    clientId: o.clientId ?? null,
    clientName: o.clientName ?? null,
    scheduledDate: o.scheduledDate ?? null,
    dueDate: o.dueDate ?? null,
    isOverdue: o.isOverdue ?? false,
    isScheduledToday: o.isScheduledToday ?? false,
    isThisWeek: o.isThisWeek ?? false,
    isActionable: o.isActionable ?? status !== "waiting",
    estimatedMinutes: o.estimatedMinutes ?? null,
    isRecurring: o.isRecurring ?? false,
    recurrenceLabel: o.recurrenceLabel ?? null,
  };
}
function completed(o: Partial<CompletedFacet> = {}): CompletedFacet {
  seq += 1;
  return {
    id: o.id ?? `c${seq}`,
    title: o.title ?? "Done",
    memberId: o.memberId ?? "m1",
    memberName: o.memberName ?? "Eloff",
    clientId: o.clientId ?? null,
    clientName: o.clientName ?? null,
    completedAt: o.completedAt ?? "2026-08-06T09:00:00Z",
    completedAtLabel: o.completedAtLabel ?? "09:00",
  };
}

describe("buildMemberDetail", () => {
  it("Today = actionable scheduled-today OR overdue, overdue first (by due date), never waiting", () => {
    const d = buildMemberDetail(
      [
        facet({ id: "sched", isScheduledToday: true }),
        facet({ id: "od-late", isOverdue: true, dueDate: "2026-08-01" }),
        facet({ id: "od-early", isOverdue: true, dueDate: "2026-07-30" }),
        facet({ id: "wait", status: "waiting", isActionable: false, isOverdue: true, dueDate: "2026-08-01" }),
      ],
      [],
      []
    );
    expect(d.today.map((f) => f.id)).toEqual(["od-early", "od-late", "sched"]); // overdue by due date, then scheduled
    expect(d.today.some((f) => f.status === "waiting")).toBe(false);
  });

  it("Upcoming = actionable not-today (future-scheduled or unscheduled), by date then priority", () => {
    const d = buildMemberDetail(
      [
        facet({ id: "today", isScheduledToday: true }),
        facet({ id: "soon", scheduledDate: "2026-08-08" }),
        facet({ id: "later", scheduledDate: "2026-08-20" }),
        facet({ id: "undated-hi", scheduledDate: null, priority: "high" }),
      ],
      [],
      []
    );
    // dated ascending first, then undated by priority
    expect(d.upcoming.map((f) => f.id)).toEqual(["soon", "later", "undated-hi"]);
    expect(d.today.map((f) => f.id)).toEqual(["today"]);
  });

  it("Waiting = only waiting tasks", () => {
    const d = buildMemberDetail(
      [facet({ id: "w1", status: "waiting", isActionable: false }), facet({ id: "p1" })],
      [],
      []
    );
    expect(d.waiting.map((f) => f.id)).toEqual(["w1"]);
  });

  it("every active task appears in EXACTLY one of Today / Upcoming / Waiting (nothing hidden)", () => {
    const active = [
      facet({ id: "a", isScheduledToday: true }),
      facet({ id: "b", isOverdue: true, dueDate: "2026-08-01" }),
      facet({ id: "c", scheduledDate: "2026-08-20" }),
      facet({ id: "d", scheduledDate: null }),
      facet({ id: "e", status: "waiting", isActionable: false }),
    ];
    const d = buildMemberDetail(active, [], []);
    const placed = [...d.today, ...d.upcoming, ...d.waiting].map((f) => f.id).sort();
    expect(placed).toEqual(["a", "b", "c", "d", "e"]);
    expect(placed.length).toBe(active.length); // no duplicates, no omissions
  });

  it("Completed sorted newest-first by completedAt", () => {
    const d = buildMemberDetail(
      [],
      [
        completed({ id: "early", completedAt: "2026-08-06T08:00:00Z" }),
        completed({ id: "late", completedAt: "2026-08-06T15:00:00Z" }),
      ],
      []
    );
    expect(d.completed.map((c) => c.id)).toEqual(["late", "early"]);
  });

  it("Clients: distinct with counts, Internal / No client always last", () => {
    const d = buildMemberDetail(
      [
        facet({ clientId: "c1", clientName: "Acme" }),
        facet({ clientId: "c1", clientName: "Acme" }),
        facet({ clientId: null }),
        facet({ clientId: "c2", clientName: "Beta" }),
      ],
      [],
      []
    );
    expect(d.clients.map((c) => `${c.name}:${c.active}`)).toEqual(["Acme:2", "Beta:1", `${INTERNAL_CLIENT_LABEL}:1`]);
  });

  it("meetings are passed through verbatim", () => {
    const d = buildMemberDetail([], [], [{ title: "Kickoff", whenLabel: "Tomorrow · 10:00" }]);
    expect(d.meetings).toEqual([{ title: "Kickoff", whenLabel: "Tomorrow · 10:00" }]);
  });
});
