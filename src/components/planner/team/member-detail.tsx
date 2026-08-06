import { type ReactNode } from "react";
import { CalendarClock, Sparkles } from "lucide-react";
import { TeamTaskRow, CompletedTaskRow } from "./team-task-row";
import type { MemberDetail } from "@/lib/planner/team/team-detail";

/** A titled Level-2 section with an optional count. */
function Section({ label, count, children }: { label: string; count?: number; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</h4>
        {count != null ? <span className="text-[11px] text-ink-300">{count}</span> : null}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <p className="py-1 text-sm text-ink-300">{text}</p>;

/**
 * Level-2 detail for one member — "everything this person is doing", all read-only.
 * Rendered from facets already on the client (instant, no fetch). Two columns on
 * desktop: the work on the left, context (clients / meetings / activity) on the
 * right. Recent activity is an honest placeholder pending the Activity feed phase.
 */
export function MemberDetailView({ detail }: { detail: MemberDetail }) {
  return (
    <div className="mt-4 grid gap-6 border-t border-ink-100 pt-4 lg:grid-cols-3">
      {/* Left: the work */}
      <div className="space-y-5 lg:col-span-2">
        <Section label="Today" count={detail.today.length}>
          {detail.today.length ? (
            <ul className="divide-y divide-ink-50">{detail.today.map((f) => <TeamTaskRow key={f.id} facet={f} />)}</ul>
          ) : (
            <Empty text="Nothing due today." />
          )}
        </Section>
        <Section label="Upcoming" count={detail.upcoming.length}>
          {detail.upcoming.length ? (
            <ul className="divide-y divide-ink-50">{detail.upcoming.map((f) => <TeamTaskRow key={f.id} facet={f} />)}</ul>
          ) : (
            <Empty text="No upcoming work." />
          )}
        </Section>
        {detail.waiting.length > 0 && (
          <Section label="Waiting" count={detail.waiting.length}>
            <ul className="divide-y divide-ink-50">{detail.waiting.map((f) => <TeamTaskRow key={f.id} facet={f} />)}</ul>
          </Section>
        )}
        {detail.completed.length > 0 && (
          <Section label="Completed today" count={detail.completed.length}>
            <ul className="divide-y divide-ink-50">{detail.completed.map((c) => <CompletedTaskRow key={c.id} item={c} />)}</ul>
          </Section>
        )}
      </div>

      {/* Right: context */}
      <div className="space-y-5">
        <Section label="Clients" count={detail.clients.length}>
          {detail.clients.length ? (
            <ul className="space-y-1">
              {detail.clients.map((c) => (
                <li key={c.clientId ?? "__internal__"} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-ink-700">{c.name}</span>
                  <span className="shrink-0 text-xs text-ink-400">{c.active}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="No client work." />
          )}
        </Section>

        <Section label="Meetings">
          {detail.meetings.length ? (
            <ul className="space-y-1.5">
              {detail.meetings.map((m) => (
                <li key={`${m.title}-${m.whenLabel}`} className="flex items-start gap-1.5 text-sm">
                  <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
                  <span className="min-w-0">
                    <span className="text-ink-700">{m.title}</span> <span className="text-ink-400">· {m.whenLabel}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="No scheduled meetings." />
          )}
        </Section>

        <Section label="Recent activity">
          <p className="flex items-center gap-1.5 py-1 text-xs text-ink-300">
            <Sparkles className="h-3.5 w-3.5" /> Coming with the Activity feed.
          </p>
        </Section>
      </div>
    </div>
  );
}
