import Link from "next/link";
import { AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getWeeklyUpdates } from "@/lib/planner/weekly/weekly-read";
import { WeeklyBoard } from "./weekly-board";

const BASE = "/admin/planner/weekly-updates";

/**
 * Weekly Updates (flag-on) — "what did we actually get done this week?". Server
 * Component: one authenticated, RLS-scoped read merges completed Planner tasks
 * (attributed by completed_by, read-only) with manual off-Planner updates into
 * presentation-safe items. The week is server-first via the `?week` param, so
 * prev/this/next are plain links (shareable, back-button friendly); only the
 * filter/search/add/delete controls hydrate as one small island.
 */
export async function WeeklyDashboard({ weekParam }: { weekParam?: string }) {
  let data;
  try {
    data = await getWeeklyUpdates(weekParam);
  } catch {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-ink-500">
          <AlertCircle className="h-4 w-4 text-ink-400" />
          <span>Couldn&rsquo;t load Weekly Updates right now. Refresh to try again.</span>
        </CardContent>
      </Card>
    );
  }

  const prevHref = `${BASE}?week=${data.prevWeek}`;
  const nextHref = `${BASE}?week=${data.nextWeek}`;
  // Default the add-form date to a day INSIDE the week being viewed, so a new
  // manual entry is visible where it was added. Today for the current week; the
  // viewed week's Monday otherwise (still editable by the admin).
  const defaultDate = data.isCurrentWeek ? data.today : data.weekStart;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-ink-200 bg-white px-3 py-2 shadow-sm">
        <Button asChild variant="ghost" size="sm" aria-label="Previous week">
          <Link href={prevHref}>
            <ChevronLeft className="h-4 w-4" /> Prev
          </Link>
        </Button>
        <div className="text-center">
          <p className="text-sm font-semibold text-ink-900">{data.weekLabel}</p>
          {data.isCurrentWeek ? (
            <p className="text-xs text-ink-400">This week</p>
          ) : (
            <Link href={BASE} className="text-xs text-brand-500 hover:underline">
              Jump to this week
            </Link>
          )}
        </div>
        <Button asChild variant="ghost" size="sm" aria-label="Next week">
          <Link href={nextHref}>
            Next <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      <WeeklyBoard
        items={data.items}
        members={data.members}
        pickerClients={data.pickerClients}
        defaultDate={defaultDate}
      />
    </div>
  );
}
