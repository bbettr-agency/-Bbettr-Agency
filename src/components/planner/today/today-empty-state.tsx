import Link from "next/link";
import { CalendarRange, Plus, PartyPopper } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** Today empty state — nothing scheduled/overdue and no meetings. */
export function TodayEmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <PartyPopper className="h-8 w-8 text-brand-500" aria-hidden />
        <div>
          <p className="text-base font-semibold text-ink-900">You&rsquo;re all caught up 🎉</p>
          <p className="mt-1 text-sm text-ink-500">No meetings today.</p>
          <p className="text-sm text-ink-500">No tasks scheduled or overdue.</p>
        </div>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/planner/week">
              <CalendarRange className="h-4 w-4" aria-hidden />
              View This Week
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/admin/planner/inbox">
              <Plus className="h-4 w-4" aria-hidden />
              Create Task
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
