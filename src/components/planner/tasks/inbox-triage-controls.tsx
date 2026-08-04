"use client";

/**
 * Per-row Inbox triage controls (C2.1d-2) — the ONLY hydrating unit in a row.
 *
 * Completes the Inbox workflow: a captured task is either Triaged (→ planned) or
 * Triaged-and-Scheduled (→ scheduled). Owner/actor/workspace are ALL derived
 * server-side inside the Server Actions; assignee is always null. This island
 * only supplies command-specific input (an optional date) + the row's target
 * (task id + the version it was rendered at) + a caller-minted idempotency key.
 *
 * It calls ONLY the two narrow Server Actions and the pure C2.1d-1 helpers — no
 * server/privileged module, no Supabase client, no database access. On success it
 * calls router.refresh(); the task's status is no longer 'inbox', so the row
 * leaves the list (RSC re-render). Pessimistic: no optimistic row removal, no
 * toast. Feedback is inline and per-row via an aria-live region.
 *
 * Idempotency (C2.1d-1 contract): Triage and Schedule hold STRUCTURALLY SEPARATE
 * intents — a key is never shared between them. Triage uses a constant payload
 * signature (retries reuse the key). Schedule's signature is the selected date, so
 * changing the date after a submission attempt mints a fresh key at the next
 * Confirm, and one key is never reused across two submitted dates.
 */
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useRouter } from "next/navigation";
import { triageTaskAction, triageAndScheduleTaskAction } from "@/app/(admin)/admin/planner/tasks/actions";
import { newIdempotencyKey } from "@/lib/planner/tasks/idempotency";
import {
  beginCommandIntent,
  clearCommandIntent,
  commandIntentAfterResult,
  intentDispositionFor,
  prepareCommandSubmit,
  IDLE,
  type CommandIntent,
} from "@/lib/planner/tasks/inbox-command-intent";
import { agencyToday, isValidScheduleDate } from "@/lib/planner/tasks/schedule-date";
import type { TaskActionResult } from "@/lib/planner/tasks/action-result";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldHelp } from "@/components/ui/input";
import type { InboxRowTarget } from "./inbox-row-target";

/** Triage carries no variable payload → a constant signature ⇒ retries reuse the key. */
const TRIAGE_SIGNATURE = "triage";
const CONFLICT_MESSAGE = "This item was already updated. Refreshing…";
const NETWORK_MESSAGE = "Something went wrong. Try again.";
const PAST_DATE_MESSAGE = "Choose today or a future date.";

export function InboxTriageControls({ target }: { target: InboxRowTarget }) {
  const router = useRouter();
  // Explicit submit flag held across the awaited Server Action via try/finally.
  // (React 18's useTransition does NOT keep isPending across the await, so it
  // cannot drive a correct loading/disable affordance — see the C2.1d-2 hardening.)
  const [submitting, setSubmitting] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const triageIntentRef = useRef<CommandIntent>(IDLE);
  const scheduleIntentRef = useRef<CommandIntent>(IDLE);
  const scheduleButtonRef = useRef<HTMLButtonElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const today = agencyToday();
  const dateId = `inbox-schedule-date-${target.taskId}`;
  const feedbackId = `inbox-triage-feedback-${target.taskId}`;

  // Focus the date field once the inline area mounts.
  useEffect(() => {
    if (scheduleOpen) dateInputRef.current?.focus();
  }, [scheduleOpen]);

  /**
   * Shared result handling. VersionConflict is terminal for BOTH intents (the
   * task moved on — a stale-version retry must never be attempted): clear both,
   * announce, refresh, and DO NOT report success. Otherwise map the result to a
   * disposition via the pure helper: success clears this command's intent and
   * refreshes; an ordinary safe failure retains it for a same-command retry.
   */
  function applyResult(result: TaskActionResult, ref: MutableRefObject<CommandIntent>): void {
    if (!result.ok && result.code === "VersionConflict") {
      triageIntentRef.current = clearCommandIntent();
      scheduleIntentRef.current = clearCommandIntent();
      setMessage(CONFLICT_MESSAGE);
      router.refresh();
      return;
    }
    ref.current = commandIntentAfterResult(ref.current, intentDispositionFor(result));
    if (result.ok) {
      setMessage(null);
      router.refresh();
    } else {
      setMessage(result.error); // retain: safe returned message only
    }
  }

  async function triage() {
    if (submitting) return;
    // Prepare the dedicated Triage intent (constant signature → key reused on retry).
    const prepared = prepareCommandSubmit(triageIntentRef.current, TRIAGE_SIGNATURE, newIdempotencyKey);
    triageIntentRef.current = prepared;
    setMessage(null);
    setSubmitting(true);
    try {
      const res = await triageTaskAction({
        taskId: target.taskId,
        expectedAggregateVersion: target.aggregateVersion,
        idempotencyKey: prepared.key,
      });
      applyResult(res, triageIntentRef);
    } catch {
      setMessage(NETWORK_MESSAGE); // retain intent for a safe retry
    } finally {
      setSubmitting(false);
    }
  }

  function openSchedule() {
    if (scheduleOpen) {
      dateInputRef.current?.focus();
      return;
    }
    setMessage(null);
    setSelectedDate(agencyToday());
    // Begin the dedicated Schedule intent (mints one key held until submit/cancel).
    scheduleIntentRef.current = beginCommandIntent(scheduleIntentRef.current, newIdempotencyKey);
    setScheduleOpen(true);
  }

  function cancelSchedule() {
    setScheduleOpen(false);
    setSelectedDate("");
    setMessage(null);
    scheduleIntentRef.current = clearCommandIntent();
    scheduleButtonRef.current?.focus();
  }

  async function confirmSchedule() {
    if (submitting) return;
    // Client-owned first boundary: reject empty/malformed/past before any call.
    if (!isValidScheduleDate(selectedDate, today)) {
      setMessage(PAST_DATE_MESSAGE);
      return;
    }
    // Signature is the selected date: a same-date retry reuses the key; a date
    // change after a submitted attempt mints a fresh one (never one key, two dates).
    const prepared = prepareCommandSubmit(scheduleIntentRef.current, selectedDate, newIdempotencyKey);
    scheduleIntentRef.current = prepared;
    setMessage(null);
    setSubmitting(true);
    try {
      const res = await triageAndScheduleTaskAction({
        taskId: target.taskId,
        expectedAggregateVersion: target.aggregateVersion,
        idempotencyKey: prepared.key,
        scheduledDate: selectedDate,
      });
      applyResult(res, scheduleIntentRef); // failure keeps the area open + date intact
    } catch {
      setMessage(NETWORK_MESSAGE); // retain same-date intent, keep area open
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={triage}
          disabled={submitting}
          loading={submitting}
          aria-busy={submitting || undefined}
          aria-label={`Triage “${target.title}”`}
        >
          Triage
        </Button>
        <Button
          ref={scheduleButtonRef}
          type="button"
          variant="ghost"
          size="sm"
          onClick={openSchedule}
          disabled={submitting}
          aria-expanded={scheduleOpen}
          aria-label={`Schedule “${target.title}”`}
        >
          Schedule
        </Button>
      </div>

      {scheduleOpen && (
        <div className="mt-2 basis-full rounded-lg border border-ink-100 bg-ink-50/60 p-3">
          <Label htmlFor={dateId}>Schedule date</Label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              id={dateId}
              ref={dateInputRef}
              type="date"
              value={selectedDate}
              min={today}
              // NB: intentionally NOT disabled while submitting — disabling a
              // focused input blurs it and a later focus() on a disabled element is
              // a no-op (the Quick Capture focus lesson). Double-submit is blocked by
              // `if (submitting) return` + the Confirm button's disabled state + the
              // op's idempotency.
              aria-busy={submitting || undefined}
              aria-describedby={feedbackId}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                if (message) setMessage(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelSchedule();
                }
              }}
              className="sm:max-w-[12rem]"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                onClick={confirmSchedule}
                disabled={submitting}
                loading={submitting}
                aria-busy={submitting || undefined}
                aria-label={`Confirm schedule for “${target.title}”`}
              >
                Confirm
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={cancelSchedule}
                aria-label={`Cancel scheduling “${target.title}”`}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {(scheduleOpen || message) && (
        // Present whenever the row is interactive (schedule open) or has feedback,
        // so the polite live region reliably announces validation/errors; omitted
        // on collapsed idle rows so their height never grows.
        <div id={feedbackId} className="basis-full" aria-live="polite">
          {message ? <FieldHelp className="text-red-600">{message}</FieldHelp> : null}
        </div>
      )}
    </>
  );
}
