import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * "What happens next" card. Keeps the client oriented and reassured:
 *  - if there are open action items, it surfaces exactly what they need to do;
 *  - otherwise it explains what the team is doing now, the estimated completion,
 *    and reassures them that nothing is required from them.
 * Presentation only — derived from the journey + existing action items.
 */

type StageState = "in_progress" | "pending" | "complete" | "none";

interface ActionItem {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
}

const IN_PROGRESS_COPY: Record<string, string> = {
  Discovery: "We’re getting to know your business, goals and audience.",
  Strategy: "We’re shaping the strategy and plan for your project.",
  Design: "Our team is designing your project.",
  Development: "Our team is currently building your project.",
  Testing: "We’re testing and polishing everything before launch.",
  Launch: "We’re preparing to launch your project.",
};

export function NextStepCard({
  stageLabel,
  state,
  estimatedCompletion,
  actionItems,
}: {
  stageLabel: string | null;
  state: StageState;
  estimatedCompletion: string | null;
  actionItems: ActionItem[];
}) {
  const hasActions = actionItems.length > 0;
  const date = estimatedCompletion
    ? format(new Date(estimatedCompletion), "d MMMM yyyy")
    : null;

  return (
    <Card className={hasActions ? "border-amber-200" : undefined}>
      <CardHeader className="flex-row items-center gap-2">
        <Sparkles className="h-4.5 w-4.5 text-brand-500" />
        <CardTitle>Next Step</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasActions ? (
          <>
            <p className="text-sm text-ink-600">
              To keep your project moving, we need a couple of things from you:
            </p>
            <ul className="space-y-2.5">
              {actionItems.map((item) => (
                <li
                  key={item.id}
                  className="rounded-xl border border-amber-200 bg-amber-50/60 p-3"
                >
                  <p className="text-sm font-semibold text-ink-900">
                    {item.title}
                  </p>
                  {item.body && (
                    <p className="mt-0.5 text-xs text-ink-600">{item.body}</p>
                  )}
                  {item.link && (
                    <Link
                      href={item.link}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
                    >
                      Take care of this <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : state === "complete" ? (
          <>
            <p className="flex items-start gap-2 text-sm text-ink-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              Your project has launched — congratulations! 🎉 We’ll be in touch
              about what’s next.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-700">
              {state === "pending" && stageLabel
                ? `Your project will move to the ${stageLabel} stage next.`
                : stageLabel
                  ? IN_PROGRESS_COPY[stageLabel] ??
                    `Our team is working on the ${stageLabel} stage of your project.`
                  : "Your team is preparing to get started."}
            </p>

            {date && (
              <div className="flex items-center gap-2.5 rounded-xl bg-ink-50 p-3">
                <CalendarClock className="h-4 w-4 text-brand-500" />
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">
                    Estimated completion
                  </p>
                  <p className="text-sm font-semibold text-ink-900">{date}</p>
                </div>
              </div>
            )}

            <p className="text-xs text-ink-400">
              You don’t need to do anything right now — we’ll let you know the
              moment we need you.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
