"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Trash2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  cancelMeetingAction,
  deleteMeetingAction,
} from "@/lib/planner/meetings/actions";

/**
 * Cancel / delete a meeting. Writes go through the domain server actions (which
 * write Portal data then invoke the reconciliation service). No sync logic here.
 */
export function MeetingRowActions({
  id,
  status,
}: {
  id: string;
  status: "scheduled" | "cancelled";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function run(fn: () => Promise<{ ok?: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {status === "scheduled" && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run(() => cancelMeetingAction(id))}
          >
            <Ban className="h-4 w-4" /> Cancel
          </Button>
        )}
        {confirmDelete ? (
          <>
            <span className="text-sm text-ink-600">Delete?</span>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirmDelete(false)}>
              No
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={pending}
              onClick={() => run(() => deleteMeetingAction(id))}
            >
              Delete
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        )}
      </div>
      {error && (
        <p className="flex items-center gap-1 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      )}
    </div>
  );
}
