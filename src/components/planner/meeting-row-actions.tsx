"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Trash2, AlertCircle, UserX, Send, RotateCcw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  cancelMeetingAction,
  deleteMeetingAction,
  markNoShowAction,
  unmarkNoShowAction,
  sendNoShowFollowUpAction,
  type MeetingActionResult,
} from "@/lib/planner/meetings/actions";

/**
 * Row-level meeting management: cancel / delete + no-show annotation and its
 * follow-up. Writes go through the domain server actions (which own Portal +
 * projection). No sync logic here. Marking a no-show is inert to Google.
 */
export function MeetingRowActions({
  id,
  status,
  noShowAt,
  followupSentAt,
}: {
  id: string;
  status: "scheduled" | "cancelled";
  noShowAt: string | null;
  followupSentAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // A transient outcome message. `ok:false` is an honest failure (rendered with a
  // warning icon, never a success check) — e.g. a follow-up that didn't reach
  // every attendee.
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function run(
    fn: () => Promise<MeetingActionResult>,
    onOk?: (res: MeetingActionResult) => void
  ) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else {
        onOk?.(res);
        router.refresh();
      }
    });
  }

  const isNoShow = Boolean(noShowAt);

  return (
    <div className="flex flex-col items-end gap-1.5">
      {status === "scheduled" && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isNoShow ? (
            <>
              <Badge tone="warning">No-show</Badge>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(() => sendNoShowFollowUpAction(id), (res) =>
                    setNotice(
                      res.emailWarning
                        ? { text: res.emailWarning, ok: false }
                        : res.emailSent
                          ? { text: "Follow-up sent to attendees.", ok: true }
                          : null
                    )
                  )
                }
              >
                <Send className="h-4 w-4" />
                {followupSentAt ? "Resend follow-up" : "Send follow-up"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => run(() => unmarkNoShowAction(id))}
              >
                <RotateCcw className="h-4 w-4" /> Undo
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => run(() => markNoShowAction(id))}
            >
              <UserX className="h-4 w-4" /> Mark no-show
            </Button>
          )}
        </div>
      )}

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

      {followupSentAt && !notice && (
        <p className="flex items-center gap-1 text-xs text-ink-400">
          <Check className="h-3.5 w-3.5 text-emerald-600" /> Follow-up sent
        </p>
      )}
      {notice &&
        (notice.ok ? (
          <p className="flex items-center gap-1 text-xs text-ink-500">
            <Check className="h-3.5 w-3.5 text-emerald-600" /> {notice.text}
          </p>
        ) : (
          <p className="flex items-start gap-1 text-xs text-amber-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {notice.text}
          </p>
        ))}
      {error && (
        <p className="flex items-center gap-1 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      )}
    </div>
  );
}
