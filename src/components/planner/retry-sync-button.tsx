"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { retryMeetingSyncAction } from "@/app/(admin)/admin/planner/actions";
import type { ProjectionSyncState } from "@/lib/database.types";

const RETRYABLE: ProjectionSyncState[] = ["failed", "pending", "disconnected"];

const OUTCOME: Record<string, string> = {
  synced: "Synced ✓",
  meet_pending: "Synced — Meet still provisioning…",
  failed: "Still failing — try again shortly.",
  disconnected: "Google is disconnected — reconnect it first.",
  busy: "Sync already in progress — try again in a moment.",
  skipped: "Google isn't connected — nothing to sync.",
};

/**
 * Per-meeting "Retry sync". Reconciles this ONE existing meeting through the
 * shared engine (same event, no duplicates). Only offered for a projection that
 * is failed / pending / disconnected. Honest per-outcome message.
 */
export function RetrySyncButton({
  meetingId,
  syncState,
}: {
  meetingId: string;
  syncState?: ProjectionSyncState;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  if (!syncState || !RETRYABLE.includes(syncState)) return null;

  function retry() {
    setNote(null);
    startTransition(async () => {
      const res = await retryMeetingSyncAction(meetingId);
      if (res.error) setNote(res.error);
      else {
        setNote(res.state ? OUTCOME[res.state] : null);
        router.refresh();
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={retry}
        disabled={pending}
        className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-800 disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} /> Retry sync
      </button>
      {note && <span className="text-xs text-ink-400">{note}</span>}
    </span>
  );
}
