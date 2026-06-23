"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Phone, Mail, CheckCircle2, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { resolveUpdateQuestionAction } from "@/app/(admin)/admin/actions";
import type { UpdateQuestionView } from "@/lib/admin-queries";

/**
 * Admin view of client ❓ follow-up requests (callback / email) raised on
 * updates. Lets the team see what was asked and mark each request resolved.
 */
export function UpdateQuestionsPanel({
  questions,
}: {
  questions: UpdateQuestionView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (questions.length === 0) return null;

  function resolve(id: string) {
    startTransition(async () => {
      await resolveUpdateQuestionAction(id);
      router.refresh();
    });
  }

  const openCount = questions.filter((q) => q.status === "open").length;

  return (
    <div className="rounded-2xl border border-amber-200 bg-white">
      <div className="flex items-center gap-2 border-b border-ink-100 p-4">
        <HelpCircle className="h-4.5 w-4.5 text-amber-500" />
        <h3 className="text-sm font-semibold text-ink-900">Client questions</h3>
        {openCount > 0 && (
          <Badge tone="warning" dot>
            {openCount} open
          </Badge>
        )}
      </div>
      <ul className="divide-y divide-ink-100">
        {questions.map((q) => {
          const Icon = q.channel === "callback" ? Phone : Mail;
          const resolved = q.status === "resolved";
          return (
            <li key={q.id} className="flex items-start gap-3 p-4">
              <span
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                  resolved ? "bg-ink-100 text-ink-400" : "bg-amber-50 text-amber-600"
                }`}
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-ink-900">
                    {q.channel === "callback" ? "Callback requested" : "Email requested"}
                  </span>
                  <Badge tone={resolved ? "success" : "warning"}>
                    {resolved ? "Resolved" : "Open"}
                  </Badge>
                  <span className="text-xs text-ink-400">
                    {format(new Date(q.created_at), "d MMM yyyy")}
                  </span>
                </div>
                {q.updateTitle && (
                  <p className="mt-0.5 text-xs text-ink-400">On: {q.updateTitle}</p>
                )}
                {q.message && (
                  <p className="mt-1 whitespace-pre-line text-sm text-ink-600">
                    {q.message}
                  </p>
                )}
              </div>
              {!resolved && (
                <Button
                  size="sm"
                  variant="outline"
                  loading={pending}
                  onClick={() => resolve(q.id)}
                >
                  <CheckCircle2 className="h-4 w-4" /> Mark resolved
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
