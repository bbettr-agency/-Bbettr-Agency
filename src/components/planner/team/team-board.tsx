"use client";

/**
 * Team View board — the ONE small client island. It holds filter state + which
 * member bands are expanded, and re-derives everything from server-provided,
 * presentation-safe view models (active facets, completed facets, member meta) via
 * pure functions (`computeBoard`, `buildMemberDetail`). It fetches NOTHING.
 *
 * Level 1 = the collapsed member bands (a 5-second scan). Level 2 = expand a band
 * in place to see EVERYTHING that person is doing — a pure client-side re-group of
 * facets already delivered, so expansion is instant. Multiple bands can be open at
 * once (compare workloads). Because every derivation is pure and every date fact is
 * baked in server-side, SSR == first client render (no hydration drift).
 */
import { useMemo, useState } from "react";
import { computeBoard, type MemberMeta, type TeamBoardFilter, type TeamTaskFacet } from "@/lib/planner/team/team-board";
import { buildMemberDetail, type CompletedFacet } from "@/lib/planner/team/team-detail";
import { TeamFilters } from "./team-filters";
import { MemberBand } from "./member-band";
import { ClientWorkloadList } from "./client-workload-list";

export function TeamBoard({
  facets,
  completed,
  members,
}: {
  facets: TeamTaskFacet[];
  completed: CompletedFacet[];
  members: MemberMeta[];
}) {
  const [filter, setFilter] = useState<TeamBoardFilter>({ memberId: "all", work: "active", search: "" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const board = useMemo(() => computeBoard(facets, members, filter), [facets, members, filter]);

  function toggle(memberId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  // Level-2 detail = the member's FULL workload (never narrowed by the work/search
  // filter — those are a Level-1 visibility lens). Built only when a band is open.
  function detailFor(memberId: string) {
    return buildMemberDetail(
      facets.filter((f) => f.memberId === memberId),
      completed.filter((c) => c.memberId === memberId),
      members.find((m) => m.id === memberId)?.meetings ?? []
    );
  }

  return (
    <div className="space-y-6">
      <TeamFilters members={members} filter={filter} onChange={setFilter} />

      {/* Team Workload — the primary section (expandable member workspaces) */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-ink-700">Team workload</h2>
          <span className="text-xs text-ink-400">
            {board.members.length} member{board.members.length === 1 ? "" : "s"}
          </span>
        </div>
        {board.members.length > 0 ? (
          <div className="space-y-3">
            {board.members.map((m) => (
              <MemberBand
                key={m.id}
                workload={m}
                expanded={expanded.has(m.id)}
                detail={expanded.has(m.id) ? detailFor(m.id) : null}
                onToggle={() => toggle(m.id)}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-500">No team members match these filters.</p>
        )}
      </section>

      {/* Client Workload (cross-client lens) */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-ink-700">Client workload</h2>
          <span className="text-xs text-ink-400">Grouped by client</span>
        </div>
        <ClientWorkloadList clients={board.clients} />
      </section>
    </div>
  );
}
