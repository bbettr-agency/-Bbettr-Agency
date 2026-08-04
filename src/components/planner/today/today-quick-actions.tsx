import Link from "next/link";
import { Plus, CalendarPlus, Inbox, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Quick actions — navigational shortcuts to existing surfaces. No "Add Note" (no
 * real notes destination exists yet). Task creation happens via Inbox capture.
 */
const ACTIONS = [
  { href: "/admin/planner/inbox", label: "New Task", icon: Plus },
  { href: "/admin/planner/meetings/new", label: "Schedule Meeting", icon: CalendarPlus },
  { href: "/admin/planner/inbox", label: "Capture Inbox", icon: Inbox },
  { href: "/admin/planner/week", label: "Open Calendar", icon: CalendarRange },
];

export function TodayQuickActions() {
  return (
    <div className="flex flex-wrap gap-2">
      {ACTIONS.map((a) => (
        <Button key={a.label} asChild variant="outline" size="sm">
          <Link href={a.href}>
            <a.icon className="h-4 w-4" aria-hidden />
            {a.label}
          </Link>
        </Button>
      ))}
    </div>
  );
}
