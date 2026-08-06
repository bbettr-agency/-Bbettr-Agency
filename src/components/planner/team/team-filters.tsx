import { Input, Label, Select } from "@/components/ui/input";
import type { MemberMeta, TeamBoardFilter, WorkFilter } from "@/lib/planner/team/team-board";

const WORK_OPTIONS: { value: WorkFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "this_week", label: "This Week" },
];

/**
 * Orthogonal Team View filters: team member (Everyone / each workspace admin),
 * a work slice (Active / Overdue / Today / This Week), and free-text search over
 * task title, member and client. Controlled — the client board owns the state and
 * re-derives the board purely; no data is re-fetched.
 */
export function TeamFilters({
  members,
  filter,
  onChange,
}: {
  members: MemberMeta[];
  filter: TeamBoardFilter;
  onChange: (next: TeamBoardFilter) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="sm:w-48">
          <Label htmlFor="team-member-filter">Team member</Label>
          <Select
            id="team-member-filter"
            value={filter.memberId}
            onChange={(e) => onChange({ ...filter, memberId: e.target.value })}
          >
            <option value="all">Everyone</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:w-44">
          <Label htmlFor="team-work-filter">Work</Label>
          <Select
            id="team-work-filter"
            value={filter.work}
            onChange={(e) => onChange({ ...filter, work: e.target.value as WorkFilter })}
          >
            {WORK_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="sm:w-64">
        <Label htmlFor="team-search">Search</Label>
        <Input
          id="team-search"
          type="search"
          value={filter.search}
          placeholder="Task, member or client…"
          onChange={(e) => onChange({ ...filter, search: e.target.value })}
        />
      </div>
    </div>
  );
}
