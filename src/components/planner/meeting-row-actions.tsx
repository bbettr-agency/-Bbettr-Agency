"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Trash2, AlertCircle, UserX, Send, RotateCcw, Check, CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  cancelMeetingAction,
  deleteMeetingAction,
  markNoShowAction,
  unmarkNoShowAction,
  sendNoShowFollowUpAction,
  markAttendedAction,
  undoAttendedAction,
  type MeetingActionResult,
} from "@/lib/planner/meetings/actions";
import type { MeetingLifecycleState } from "@/lib/planner/meetings/lifecycle";

/**
 * State-aware row-level meeting management. The primary actions follow the
 * derived lifecycle state; Cancel/Delete stay available but visually secondary
 * on an ended meeting. Writes go through the domain server actions (which own
 * Portal + projection). No sync logic here — mark attended / no-show are inert to
 * Google. The no-show branch is preserved exactly from Slice C/D.
 */
export function MeetingRowActions({
  id,
  state,
  noShowAt,
  followupSentAt,
  thankYouSentAt,
}: {
  id: string;
  state: MeetingLifecycleState;
  noShowAt: string | null;
  followupSentAt: string | null;
  thankYouSentAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function run(fn: () => Promise<MeetingActionResult>, onOk?: (res: MeetingActionResult) => void) {
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

  const deleteBtn =
    state === "cancelled" || confirmDelete ? (
      confirmDelete ? (
        <>
          <span className="text-sm text-ink-600">Delete?</span>
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirmDelete(false)}>No</Button>
          <Button variant="danger" size="sm" loading={pending} onClick={() => run(() => deleteMeetingAction(id))}>Delete</Button>
        </>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
      )
    ) : (
      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
        <Trash2 className="h-4 w-4" /> Delete
      </Button>
    );

  const cancelBtn = (
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => cancelMeetingAction(id))}>
      <Ban className="h-4 w-4" /> Cancel
    </Button>
  );

  return (
    <div className="flex flex-col items-end gap-1.5">
      {/* Primary, state-specific actions */}
      {state === "needs_outcome" && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" disabled={pending} onClick={() => run(() => markAttendedAction(id))}>
            <CalendarCheck className="h-4 w-4" /> Mark attended
          </Button>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => markNoShowAction(id))}>
            <UserX className="h-4 w-4" /> Mark no-show
          </Button>
        </div>
      )}

      {state === "completed" && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/admin/planner/meetings/${id}#followup`}>
              <Send className="h-4 w-4" /> {thankYouSentAt ? "Send another follow-up" : "Send follow-up"}
            </Link>
          </Button>
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => undoAttendedAction(id))}>
            <RotateCcw className="h-4 w-4" /> Undo attended
          </Button>
        </div>
      )}

      {/* No-show branch — preserved from Slice C/D. */}
      {state === "no_show" && (
        <div className="flex flex-wrap items-center justify-end gap-2">
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
                      ? { text: "Follow-up sent to attendees." , ok: true }
                      : null
                )
              )
            }
          >
            <Send className="h-4 w-4" /> {followupSentAt ? "Resend follow-up" : "Send follow-up"}
          </Button>
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => unmarkNoShowAction(id))}>
            <RotateCcw className="h-4 w-4" /> Undo
          </Button>
        </div>
      )}

      {/* Secondary Cancel/Delete. Cancel only for still-active (scheduled) states;
          cancelled meetings are read-only apart from archival delete. */}
      <div className="flex items-center gap-2">
        {(state === "upcoming" || state === "needs_outcome" || state === "no_show") && cancelBtn}
        {deleteBtn}
      </div>

      {/* Evidence + honest notices */}
      {(state === "completed" || state === "no_show") && thankYouSentAtEvidence(state, thankYouSentAt, followupSentAt) && !notice && (
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

/** Whether to show the "Follow-up sent" evidence line for the current state. */
function thankYouSentAtEvidence(
  state: MeetingLifecycleState,
  thankYouSentAt: string | null,
  followupSentAt: string | null
): boolean {
  if (state === "completed") return Boolean(thankYouSentAt);
  if (state === "no_show") return Boolean(followupSentAt);
  return false;
}
