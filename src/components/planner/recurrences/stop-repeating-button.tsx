"use client";

/** "Stop repeating" — deactivates a recurring definition; already-generated
 * occurrences are left untouched. Refreshes the list on success. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { deactivateRecurringDefinitionAction } from "@/app/(admin)/admin/planner/recurrences/actions";

export function StopRepeatingButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function stop() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await deactivateRecurringDefinitionAction({ id });
      if (res.ok) router.refresh();
      else setMessage(res.error);
    } catch {
      setMessage("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button type="button" size="sm" variant="outline" onClick={stop} disabled={busy} loading={busy} aria-busy={busy || undefined}>
        Stop repeating
      </Button>
      {message ? <span className="text-xs text-red-600">{message}</span> : null}
    </div>
  );
}
