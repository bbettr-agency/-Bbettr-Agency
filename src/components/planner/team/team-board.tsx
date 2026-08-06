"use client";

/**
 * Team View board — the ONE small client island. It holds only filter state and
 * re-derives the visible board from server-provided, presentation-safe view
 * models (facets + member meta) via the pure `computeBoard`. It fetches NOTHING:
 * all reads happened on the server. Because `computeBoard` is pure and every date
 * fact is baked into the facets server-side, the SSR render and first client
 * render are identical (no hydration mismatch).
 */
import { useMemo, useState } from "react";
import { computeBoard, type MemberMeta, type TeamBoardFilter, type TeamTaskFacet } from "@/lib/planner/team/team-board";
import { TeamFilters } from "./team-filters";
import { MemberCard } from "./member-card";
import { ClientWorkloadList } from "./client-workload-list";

export function TeamBoard({ facets, members }: { facets: TeamTaskFacet[]; members: MemberMeta[] }) {
  const [filter, setFilter] = useState<TeamBoardFilter>({ memberId: "all", work: "active", search: "" });
  const board = useMemo(() => computeBoard(facets, members, filter), [facets, members, filter]);

  return (
    <div className="space-y-6">
      <TeamFilters members={members} filter={filter} onChange={setFilter} />

      {/* Team Workload — the primary section */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-ink-700">Team workload</h2>
          <span className="text-xs text-ink-400">
            {board.members.length} member{board.members.length === 1 ? "" : "s"}
          </span>
        </div>
        {board.members.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {board.members.map((m) => (
              <MemberCard key={m.id} member={m} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-500">No team members match these filters.</p>
        )}
      </section>

      {/* Client Workload */}
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
