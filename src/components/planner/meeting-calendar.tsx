"use client";

import { useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { MeetingList } from "./meeting-list";
import {
  deriveMeetingState,
  LIFECYCLE_META,
  LIFECYCLE_TABS,
  type MeetingLifecycleState,
} from "@/lib/planner/meetings/lifecycle";
import type { SafeProjectionView, CalendarMeeting } from "@/lib/planner/meetings/view-types";

/**
 * The Calendar surface: one page, five derived tabs. Upcoming is the default;
 * Needs outcome carries a prominent count so overdue meetings can't hide.
 * `nowIso` is fixed by the server so SSR and hydration derive identical states
 * (no boundary flicker). Nothing here talks to Google — states are derived from
 * stored annotations only.
 */
export function MeetingCalendar({
  meetings,
  viewsObj,
  nowIso,
}: {
  meetings: CalendarMeeting[];
  viewsObj: Record<string, SafeProjectionView>;
  nowIso: string;
}) {
  const [active, setActive] = useState<MeetingLifecycleState>("upcoming");
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const views = useMemo(() => new Map(Object.entries(viewsObj)), [viewsObj]);

  const groups = useMemo(() => {
    const g: Record<MeetingLifecycleState, CalendarMeeting[]> = {
      upcoming: [], needs_outcome: [], completed: [], no_show: [], cancelled: [],
    };
    for (const m of meetings) g[deriveMeetingState(m, now)].push(m);
    // Future-facing tabs soonest-first; past/archive tabs most-recent-first.
    const asc = (a: CalendarMeeting, b: CalendarMeeting) => Date.parse(a.starts_at) - Date.parse(b.starts_at);
    const desc = (a: CalendarMeeting, b: CalendarMeeting) => Date.parse(b.starts_at) - Date.parse(a.starts_at);
    g.upcoming.sort(asc);
    g.needs_outcome.sort(desc);
    g.completed.sort(desc);
    g.no_show.sort(desc);
    g.cancelled.sort(desc);
    return g;
  }, [meetings, now]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Meeting lifecycle">
        {LIFECYCLE_TABS.map((tab) => {
          const count = groups[tab].length;
          const isActive = tab === active;
          const isOutcome = tab === "needs_outcome";
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(tab)}
              className={[
                "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
                isActive
                  ? "border-brand-500 bg-brand-500 text-white shadow-brand"
                  : "border-ink-200 bg-white text-ink-700 hover:border-brand-300 hover:bg-brand-50",
              ].join(" ")}
            >
              {LIFECYCLE_META[tab].label}
              {count > 0 && (
                <span
                  className={[
                    "inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-xs font-bold",
                    isActive
                      ? "bg-white/25 text-white"
                      : isOutcome
                        ? "bg-amber-500 text-white" // prominent: overdue meetings must be hard to miss
                        : "bg-ink-100 text-ink-600",
                  ].join(" ")}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {groups[active].length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-ink-200 py-12 text-center">
          <CalendarClock className="h-7 w-7 text-ink-300" />
          <p className="text-sm text-ink-500">Nothing in {LIFECYCLE_META[active].label.toLowerCase()}.</p>
        </div>
      ) : (
        <MeetingList meetings={groups[active]} views={views} now={now} />
      )}
    </div>
  );
}
