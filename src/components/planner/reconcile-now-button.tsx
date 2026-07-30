"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  reconcileNowAction,
  rebuildCalendarAction,
} from "@/app/(admin)/admin/planner/actions";

/**
 * Triggers a due-reconciliation pass through the Scheduler abstraction (same
 * path as the scheduled trigger). Shows the structured summary. No Google calls
 * here — it invokes a server action.
 */
export function ReconcileNowButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function reconcile() {
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

  function rebuild() {
    if (!confirm("Rebuild re-syncs every meeting's calendar projection. Continue?"))
      return;
    setMsg(null);
    startTransition(async () => {
      const res = await rebuildCalendarAction();
      if (res.error) setMsg(res.error);
      else if (res.summary) {
        const s = res.summary;
        setMsg(
          `Rebuilt ${s.rebuilt}/${s.processed} · ${s.failed} failed · ${s.skipped} skipped · ${s.durationMs}ms`
        );
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" size="sm" onClick={reconcile} loading={pending}>
        <RefreshCw className="h-4 w-4" /> Reconcile now
      </Button>
      <Button variant="ghost" size="sm" onClick={rebuild} disabled={pending}>
        <Wrench className="h-4 w-4" /> Rebuild
      </Button>
      {msg && <span className="text-xs text-ink-500">{msg}</span>}
    </div>
  );
}
