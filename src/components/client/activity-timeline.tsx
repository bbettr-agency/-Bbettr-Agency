import {
  Rocket,
  CreditCard,
  FileText,
  FileSignature,
  ClipboardCheck,
  PackageCheck,
  Palette,
  Code,
  FlaskConical,
  CalendarClock,
  PartyPopper,
  KeyRound,
  CheckCircle2,
  Circle,
  History,
  type LucideIcon,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Premium client-facing activity timeline (newest first) — the curated project
 * story from the standalone activity_events stream. Presentation only.
 */

interface ActivityItem {
  id: string;
  type: string;
  title: string;
  description: string | null;
  icon: string | null;
  occurred_at: string;
}

/** Event type → icon. Falls back to a neutral dot for unknown/custom types. */
const TYPE_ICONS: Record<string, LucideIcon> = {
  project_created: Rocket,
  portal_access_granted: KeyRound,
  contract_signed: FileSignature,
  invoice_sent: FileText,
  invoice_paid: CreditCard,
  onboarding_submitted: ClipboardCheck,
  assets_received: PackageCheck,
  discovery_complete: CheckCircle2,
  strategy_approved: CheckCircle2,
  design_started: Palette,
  design_approved: CheckCircle2,
  development_started: Code,
  testing_started: FlaskConical,
  launch_scheduled: CalendarClock,
  website_launched: PartyPopper,
  launch: PartyPopper,
};

export function ActivityTimeline({ events }: { events: ActivityItem[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2">
        <History className="h-4.5 w-4.5 text-brand-500" />
        <CardTitle>Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length > 0 ? (
          <ol className="relative">
            {events.map((event, i) => {
              const Icon = TYPE_ICONS[event.type] ?? Circle;
              const isLast = i === events.length - 1;
              const occurred = new Date(event.occurred_at);
              return (
                <li key={event.id} className="relative flex gap-4 pb-6 last:pb-0">
                  {!isLast && (
                    <span
                      aria-hidden
                      className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-0.5 bg-ink-100"
                    />
                  )}
                  <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="pt-0.5">
                    <p className="text-sm font-semibold text-ink-900">
                      {event.title}
                    </p>
                    {event.description && (
                      <p className="mt-0.5 text-xs text-ink-500">
                        {event.description}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-ink-400">
                      {formatDistanceToNow(occurred, { addSuffix: true })} ·{" "}
                      {format(occurred, "d MMM yyyy")}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="py-8 text-center text-sm text-ink-400">
            Your project activity will appear here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
