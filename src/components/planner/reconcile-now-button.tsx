"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reconcileNowAction } from "@/app/(admin)/admin/planner/actions";

/**
 * Triggers a due-reconciliation pass through the Scheduler abstraction (same
 * path as the scheduled trigger). Shows the structured summary. No Google calls
 * here — it invokes a server action.
 */
export function ReconcileNowButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    setMsg(null);
    startTransition(async () => {
      const res = await reconcileNowAction();
      if (res.error) setMsg(res.error);
      else if (res.summary) {
        const s = res.summary;
        setMsg(
          `Processed ${s.processed} · ${s.succeeded} synced · ${s.failed} failed · ${s.skipped} skipped`
        );
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <Button variant="outline" size="sm" onClick={run} loading={pending}>
        <RefreshCw className="h-4 w-4" /> Reconcile now
      </Button>
      {msg && <span className="text-xs text-ink-500">{msg}</span>}
    </div>
  );
}
