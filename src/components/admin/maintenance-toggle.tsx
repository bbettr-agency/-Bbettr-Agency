"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, AlertCircle, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { setMaintenanceModeAction } from "@/app/(admin)/admin/settings/actions";

export function MaintenanceToggle({ initialOn }: { initialOn: boolean }) {
  const [on, setOn] = useState(initialOn);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(
    null
  );

  function toggle() {
    const next = !on;
    setFeedback(null);
    setOn(next); // optimistic
    startTransition(async () => {
      const res = await setMaintenanceModeAction(next);
      if (res.error) {
        setOn(!next); // revert
        setFeedback({ ok: false, msg: res.error });
      } else {
        setFeedback({
          ok: true,
          msg: next
            ? "Maintenance mode is ON — clients now see the maintenance notice."
            : "Maintenance mode is OFF — clients have normal access.",
        });
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink-700">
            Client Portal Maintenance Mode
          </p>
          <p className="mt-0.5 text-sm text-ink-500">
            When enabled, clients see a maintenance notice instead of the normal
            portal. Admin access is not affected.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {on ? (
            <Badge tone="warning" dot>
              On
            </Badge>
          ) : (
            <Badge tone="neutral" dot>
              Off
            </Badge>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Toggle client portal maintenance mode"
            disabled={pending}
            onClick={toggle}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
              on ? "bg-amber-500" : "bg-ink-200"
            )}
          >
            <span
              className={cn(
                "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                on ? "translate-x-[22px]" : "translate-x-0.5"
              )}
            />
          </button>
        </div>
      </div>

      {on && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <Wrench className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Clients currently see the maintenance notice. You still have full admin access.</span>
        </div>
      )}

      {feedback && (
        <p
          className={cn(
            "flex items-center gap-1.5 text-sm",
            feedback.ok ? "text-emerald-600" : "text-red-600"
          )}
        >
          {feedback.ok ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          {feedback.msg}
        </p>
      )}
    </div>
  );
}
