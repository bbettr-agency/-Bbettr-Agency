import Link from "next/link";
import { Inbox, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { InternalFeedItem } from "@/lib/internal-notifications";

/** Actionable Inbox — real admin-side sources only: the Tasks Inbox triage count +
 *  the admin's internal notification feed. No Client-Portal notifications, no
 *  invented types. */
export function TodayActionableInbox({ items, inboxCount }: { items: InternalFeedItem[]; inboxCount: number }) {
  const empty = inboxCount === 0 && items.length === 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Actionable inbox</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {inboxCount > 0 ? (
          <Link href="/admin/planner/inbox" className="flex items-center justify-between gap-2 rounded-lg border border-ink-100 px-3 py-2 text-sm text-ink-800 hover:bg-ink-50">
            <span className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-ink-400" aria-hidden />
              {inboxCount} {inboxCount === 1 ? "task" : "tasks"} to triage in the Inbox
            </span>
            <ChevronRight className="h-4 w-4 text-ink-300" aria-hidden />
          </Link>
        ) : null}
        {items.map((n) => {
          const body = (
            <span className="min-w-0">
              <span className="block truncate font-medium text-ink-800">{n.title}</span>
              {n.body ? <span className="block truncate text-xs text-ink-500">{n.body}</span> : null}
            </span>
          );
          return n.link ? (
            <Link key={n.id} href={n.link} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm hover:bg-ink-50">
              {body}
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-300" aria-hidden />
            </Link>
          ) : (
            <div key={n.id} className="rounded-lg px-3 py-2 text-sm">
              {body}
            </div>
          );
        })}
        {empty ? <p className="text-sm text-ink-500">Nothing needs your attention.</p> : null}
      </CardContent>
    </Card>
  );
}
