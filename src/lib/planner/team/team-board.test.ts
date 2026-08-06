import { describe, it, expect } from "vitest";
import {
  toFacet,
  summarizeEstimates,
  pickCurrentFocus,
  buildClientWorkloads,
  applyFilter,
  computeBoard,
  buildSummary,
  formatWorkload,
  INTERNAL_CLIENT_LABEL,
  type TeamTaskFacet,
  type MemberMeta,
  type ActiveTaskStatus,
} from "./team-board";
import type { Task, TaskPriority } from "@/lib/database.types";

const TODAY = "2026-08-06";
const WEEK_START = "2026-08-03";
const WEEK_END = "2026-08-09";

// ── facet factory (board-level tests operate on facets directly) ───────────────
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
    isOverdue: o.isOverdue ?? false,
    isScheduledToday: o.isScheduledToday ?? false,
    isThisWeek: o.isThisWeek ?? false,
    isActionable: o.isActionable ?? status !== "waiting",
    estimatedMinutes: o.estimatedMinutes ?? null,
  };
}

const members: MemberMeta[] = [
  { id: "m1", name: "Eloff", nextMeeting: null },
  { id: "m2", name: "Ashwin", nextMeeting: { title: "Client sync", whenLabel: "Today · 14:00" } },
];

// ── toFacet ────────────────────────────────────────────────────────────────
function task(o: Partial<Task> = {}): Task {
  return {
    id: "task-1", workspace_id: "ws1", title: "A task", description: null, status: "planned",
    created_by: "m1", owner_user_id: "m1", assignee_id: null, priority: "normal", critical_reason: null,
    estimated_minutes: null, scheduled_date: null, due_date: null, started_at: null, completed_at: null,
    completed_by: null, archived_at: null, archive_reason: null, blocked_since: null, resume_target: null,
    aggregate_version: 1, parent_id: null, client_id: null, recurrence_definition_id: null, occurrence_slot: null,
    created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", deleted_at: null,
    ...o,
  } as Task;
}
const names = new Map([["m1", "Eloff"], ["m2", "Ashwin"]]);
const clients = new Map([["c1", "Acme"]]);

describe("toFacet", () => {
  it("projects an active task; responsible = assignee when present, else owner", () => {
    const f = toFacet(task({ status: "in_progress", owner_user_id: "m1", assignee_id: "m2" }), names, clients, TODAY, WEEK_START, WEEK_END)!;
    expect(f.memberId).toBe("m2"); // assignee wins
    expect(f.memberName).toBe("Ashwin");
    const g = toFacet(task({ status: "planned", owner_user_id: "m1", assignee_id: null }), names, clients, TODAY, WEEK_START, WEEK_END)!;
    expect(g.memberId).toBe("m1"); // falls back to owner
  });
  it("returns null for inbox/completed/archived (non-active) and for ownerless tasks", () => {
    for (const status of ["inbox", "completed", "archived"] as const) {
      expect(toFacet(task({ status }), names, clients, TODAY, WEEK_START, WEEK_END)).toBeNull();
    }
    expect(toFacet(task({ status: "planned", owner_user_id: null, assignee_id: null }), names, clients, TODAY, WEEK_START, WEEK_END)).toBeNull();
  });
  it("resolves real client name only; keeps null for no client (never inferred)", () => {
    expect(toFacet(task({ client_id: "c1" }), names, clients, TODAY, WEEK_START, WEEK_END)!.clientName).toBe("Acme");
    const noClient = toFacet(task({ client_id: null }), names, clients, TODAY, WEEK_START, WEEK_END)!;
    expect(noClient.clientId).toBeNull();
    expect(noClient.clientName).toBeNull();
  });
  it("derives date flags: overdue (due<today), scheduledToday, thisWeek; waiting is not actionable", () => {
    const overdue = toFacet(task({ due_date: "2026-08-01" }), names, clients, TODAY, WEEK_START, WEEK_END)!;
    expect(overdue.isOverdue).toBe(true);
    const sched = toFacet(task({ scheduled_date: TODAY }), names, clients, TODAY, WEEK_START, WEEK_END)!;
    expect(sched.isScheduledToday).toBe(true);
    expect(sched.isThisWeek).toBe(true);
    const nextWeek = toFacet(task({ scheduled_date: "2026-08-20" }), names, clients, TODAY, WEEK_START, WEEK_END)!;
    expect(nextWeek.isThisWeek).toBe(false);
    const waiting = toFacet(task({ status: "waiting", blocked_since: "2026-08-05T00:00:00Z", resume_target: "planned", owner_user_id: "m1" }), names, clients, TODAY, WEEK_START, WEEK_END)!;
    expect(waiting.isActionable).toBe(false);
  });
  it("resolves an unknown responsible id to 'Unknown' (never fabricated as a real name)", () => {
    const f = toFacet(task({ owner_user_id: "ghost", assignee_id: null }), names, clients, TODAY, WEEK_START, WEEK_END)!;
    expect(f.memberName).toBe("Unknown");
  });
});

// ── capacity: summarizeEstimates ─────────────────────────────────────────────
describe("summarizeEstimates (capacity ruling)", () => {
  it("null minutes when NO in-scope task has an estimate; counts them", () => {
    const s = summarizeEstimates([facet(), facet(), facet()]);
    expect(s.estimatedMinutes).toBeNull();
    expect(s.noEstimateCount).toBe(3);
  });
  it("sums only tasks with estimates and reports the rest as noEstimateCount", () => {
    const s = summarizeEstimates([facet({ estimatedMinutes: 30 }), facet({ estimatedMinutes: 90 }), facet()]);
    expect(s.estimatedMinutes).toBe(120);
    expect(s.noEstimateCount).toBe(1);
  });
  it("excludes waiting/blocked tasks from the estimate scope entirely", () => {
    const s = summarizeEstimates([facet({ estimatedMinutes: 60 }), facet({ status: "waiting", isActionable: false, estimatedMinutes: 999 })]);
    expect(s.estimatedMinutes).toBe(60); // waiting task's estimate never counted
    expect(s.noEstimateCount).toBe(0); // and it is not counted as "no estimate" either
  });
});

// ── current focus determinism ────────────────────────────────────────────────
describe("pickCurrentFocus (deterministic; never waiting)", () => {
  it("prefers an overdue actionable task over in-progress and planned", () => {
    const f = pickCurrentFocus([
      facet({ id: "p", status: "planned", priority: "critical" }),
      facet({ id: "ip", status: "in_progress" }),
      facet({ id: "od", status: "planned", isOverdue: true, priority: "low" }),
    ]);
    expect(f?.id).toBe("od");
  });
  it("falls back to in-progress when nothing is overdue", () => {
    const f = pickCurrentFocus([facet({ id: "p", status: "planned", priority: "critical" }), facet({ id: "ip", status: "in_progress", priority: "low" })]);
    expect(f?.id).toBe("ip");
  });
  it("otherwise picks the highest-priority active task", () => {
    const f = pickCurrentFocus([facet({ id: "lo", priority: "low" }), facet({ id: "hi", priority: "high" }), facet({ id: "no", priority: "normal" })]);
    expect(f?.id).toBe("hi");
  });
  it("NEVER selects a waiting task, even if it is the only one", () => {
    expect(pickCurrentFocus([facet({ status: "waiting", isActionable: false })])).toBeNull();
  });
  it("is stable: ties broken by id", () => {
    const f = pickCurrentFocus([facet({ id: "b", priority: "high" }), facet({ id: "a", priority: "high" })]);
    expect(f?.id).toBe("a");
  });
});

// ── client grouping ──────────────────────────────────────────────────────────
describe("buildClientWorkloads", () => {
  it("groups by real client_id; null lands in Internal / No client, always last", () => {
    const groups = buildClientWorkloads([
      facet({ clientId: "c1", clientName: "Acme" }),
      facet({ clientId: null }),
      facet({ clientId: "c1", clientName: "Acme", isOverdue: true }),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["Acme", INTERNAL_CLIENT_LABEL]);
    expect(groups[0].active).toBe(2);
    expect(groups[0].overdue).toBe(1);
    expect(groups[groups.length - 1].clientId).toBeNull();
  });
  it("collects distinct assignees (sorted) and distinct statuses (canonical order)", () => {
    const g = buildClientWorkloads([
      facet({ clientId: "c1", clientName: "Acme", memberName: "Zed", status: "in_progress" }),
      facet({ clientId: "c1", clientName: "Acme", memberName: "Ann", status: "planned" }),
      facet({ clientId: "c1", clientName: "Acme", memberName: "Ann", status: "waiting", isActionable: false }),
    ])[0];
    expect(g.assignees).toEqual(["Ann", "Zed"]);
    expect(g.statuses).toEqual(["planned", "in_progress", "waiting"]);
  });
});

// ── filters ──────────────────────────────────────────────────────────────────
describe("applyFilter", () => {
  const set = [
    facet({ id: "a", memberId: "m1", isOverdue: true }),
    facet({ id: "b", memberId: "m2", isScheduledToday: true, isThisWeek: true }),
    facet({ id: "c", memberId: "m2", isThisWeek: true, title: "Acme rollout", clientName: "Acme" }),
    facet({ id: "d", memberId: "m1" }),
  ];
  it("member filter keeps only that member", () => {
    expect(applyFilter(set, { memberId: "m2", work: "active", search: "" }).map((f) => f.id)).toEqual(["b", "c"]);
  });
  it("work=overdue keeps only overdue; today folds overdue in; this_week folds overdue in", () => {
    expect(applyFilter(set, { memberId: "all", work: "overdue", search: "" }).map((f) => f.id)).toEqual(["a"]);
    expect(applyFilter(set, { memberId: "all", work: "today", search: "" }).map((f) => f.id).sort()).toEqual(["a", "b"]);
    expect(applyFilter(set, { memberId: "all", work: "this_week", search: "" }).map((f) => f.id).sort()).toEqual(["a", "b", "c"]);
  });
  it("search matches title, member or client, case-insensitively", () => {
    expect(applyFilter(set, { memberId: "all", work: "active", search: "acme" }).map((f) => f.id)).toEqual(["c"]);
  });
});

// ── computeBoard visibility + sorting ────────────────────────────────────────
describe("computeBoard", () => {
  it("Active view shows EVERY member card (incl. zero-task members) so capacity is visible", () => {
    const facets = [facet({ memberId: "m1" }), facet({ memberId: "m1" })]; // m2 has nothing
    const board = computeBoard(facets, members, { memberId: "all", work: "active", search: "" });
    expect(board.members.map((m) => m.id)).toEqual(["m1", "m2"]); // busiest first, empty last
    expect(board.members[1].active).toBe(0);
    expect(board.members[1].currentFocus).toBeNull();
  });
  it("narrowing filters (overdue) hide members with no matching work", () => {
    const facets = [facet({ memberId: "m1", isOverdue: true }), facet({ memberId: "m2" })];
    const board = computeBoard(facets, members, { memberId: "all", work: "overdue", search: "" });
    expect(board.members.map((m) => m.id)).toEqual(["m1"]);
  });
  it("an explicit member selection always shows that one card, even with zero tasks", () => {
    const board = computeBoard([], members, { memberId: "m2", work: "overdue", search: "" });
    expect(board.members.map((m) => m.id)).toEqual(["m2"]);
  });
  it("member.nextMeeting is carried onto the card verbatim", () => {
    const board = computeBoard([facet({ memberId: "m2" })], members, { memberId: "m2", work: "active", search: "" });
    expect(board.members[0].nextMeeting).toEqual({ title: "Client sync", whenLabel: "Today · 14:00" });
  });
});

// ── summary + formatting ─────────────────────────────────────────────────────
describe("buildSummary", () => {
  it("reports workspace totals from all facets + injected completed/meeting counts", () => {
    const s = buildSummary([facet({ isOverdue: true }), facet()], 2, 3, 4);
    expect(s).toEqual({ members: 2, activeTasks: 2, overdueTasks: 1, completedToday: 3, meetingsToday: 4 });
  });
});

describe("formatWorkload", () => {
  it("formats minutes as compact h/m", () => {
    expect(formatWorkload(0)).toBe("0m");
    expect(formatWorkload(45)).toBe("45m");
    expect(formatWorkload(60)).toBe("1h");
    expect(formatWorkload(150)).toBe("2h 30m");
  });
});

// exhaustiveness guard for the priority set used above
const _priorities: TaskPriority[] = ["critical", "high", "normal", "low"];
void _priorities;
