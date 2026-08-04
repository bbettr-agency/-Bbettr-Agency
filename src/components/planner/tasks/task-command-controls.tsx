"use client";

/**
 * Shared per-row task command controls (Task Kit) — the only hydrating unit in a
 * task row. Renders ONLY the server-computed legal actions for the task's status
 * and dispatches each through the approved narrow Server Actions. The state
 * machine remains authoritative: the browser cannot force an illegal transition
 * (an illegal command → safe failure). No server/privileged module, no DB access.
 *
 * Interaction reuses the hardened Inbox pattern: an explicit `submitting` flag
 * held across the awaited action (correct disabled + loading + aria-busy; rapid
 * clicks collapse to one request), the C2.1d-1 idempotency-intent state machine
 * (one key per attempt; a payload/command change mints a new key; safe retries
 * reuse it), pessimistic `router.refresh()` on success, and safe inline feedback.
 * Instant actions are single-click; schedule/reschedule open an inline native date
 * area; block opens a minimal inline reason area. The focused date/reason input is
 * never disabled while submitting.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  startTaskAction,
  completeTaskAction,
  scheduleTaskAction,
  rescheduleTaskAction,
  unscheduleTaskAction,
  deferTaskAction,
  blockTaskAction,
  unblockTaskAction,
  dropTaskAction,
} from "@/app/(admin)/admin/planner/tasks/actions";
import { newIdempotencyKey } from "@/lib/planner/tasks/idempotency";
import { clearCommandIntent, commandIntentAfterResult, intentDispositionFor, prepareCommandSubmit, IDLE, type CommandIntent } from "@/lib/planner/tasks/inbox-command-intent";
import { agencyToday, isValidScheduleDate } from "@/lib/planner/tasks/schedule-date";
import { legalActionsFor, TASK_ACTION_LABEL, type TaskActionDescriptor, type TaskActionKey } from "@/lib/planner/tasks/task-legality";
import type { TaskActionResult } from "@/lib/planner/tasks/action-result";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldHelp, Select } from "@/components/ui/input";
import type { TaskCommandTarget } from "./task-command-target";

const CONFLICT_MESSAGE = "This item was already updated. Refreshing…";
const NETWORK_MESSAGE = "Something went wrong. Try again.";
const PAST_DATE_MESSAGE = "Choose today or a future date.";
const BLOCKER_CLASSES = ["person", "client", "approval", "asset", "dependency"] as const;
type BlockerClassInput = (typeof BLOCKER_CLASSES)[number];

/** Server Actions never receive actor/owner/workspace — only the target + command input + the key. */
type Base = { taskId: string; expectedAggregateVersion: number };

export function TaskCommandControls({ target }: { target: TaskCommandTarget }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [openArea, setOpenArea] = useState<null | "date" | "block">(null);
  const [dateKey, setDateKey] = useState<"schedule" | "reschedule">("schedule");
  const [selectedDate, setSelectedDate] = useState("");
  const [blockerClass, setBlockerClass] = useState<BlockerClassInput>("approval");
  const [blockerReason, setBlockerReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null); // which control is in-flight (spinner target)

  const intentRef = useRef<CommandIntent>(IDLE);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const reasonInputRef = useRef<HTMLInputElement>(null);
  const areaTriggerRef = useRef<HTMLButtonElement | null>(null);

  const today = agencyToday();
  const base: Base = { taskId: target.taskId, expectedAggregateVersion: target.aggregateVersion };
  const actions = legalActionsFor(target.status);
  const feedbackId = `task-controls-feedback-${target.taskId}`;
  const dateId = `task-schedule-date-${target.taskId}`;
  const reasonId = `task-block-reason-${target.taskId}`;
  const classId = `task-block-class-${target.taskId}`;

  useEffect(() => {
    if (openArea === "date") dateInputRef.current?.focus();
    else if (openArea === "block") reasonInputRef.current?.focus();
  }, [openArea]);

  function applyResult(result: TaskActionResult): void {
    if (!result.ok && result.code === "VersionConflict") {
      intentRef.current = clearCommandIntent();
      setMessage(CONFLICT_MESSAGE);
      router.refresh();
      return;
    }
    intentRef.current = commandIntentAfterResult(intentRef.current, intentDispositionFor(result));
    if (result.ok) {
      setMessage(null);
      setOpenArea(null);
      router.refresh();
    } else {
      setMessage(result.error); // retain: keep any open area + inputs, safe message only
    }
  }

  /** One dispatch path for every action: submitting guard + idempotency intent + result handling. */
  async function run(active: string, signature: string, call: (idempotencyKey: string) => Promise<TaskActionResult>): Promise<void> {
    if (submitting) return;
    const prepared = prepareCommandSubmit(intentRef.current, signature, newIdempotencyKey);
    intentRef.current = prepared;
    setMessage(null);
    setActiveKey(active);
    setSubmitting(true);
    try {
      applyResult(await call(prepared.key));
    } catch {
      setMessage(NETWORK_MESSAGE); // retain intent for a safe retry
    } finally {
      setSubmitting(false);
      setActiveKey(null);
    }
  }

  function closeArea() {
    setOpenArea(null);
    setSelectedDate("");
    setBlockerReason("");
    setMessage(null);
    intentRef.current = clearCommandIntent();
    areaTriggerRef.current?.focus();
  }

  function onInstant(key: TaskActionKey) {
    const calls: Partial<Record<TaskActionKey, (k: string) => Promise<TaskActionResult>>> = {
      start: (k) => startTaskAction({ ...base, idempotencyKey: k }),
      complete: (k) => completeTaskAction({ ...base, idempotencyKey: k }),
      unschedule: (k) => unscheduleTaskAction({ ...base, idempotencyKey: k }),
      defer: (k) => deferTaskAction({ ...base, idempotencyKey: k }),
      unblock: (k) => unblockTaskAction({ ...base, idempotencyKey: k }),
      drop: (k) => dropTaskAction({ ...base, idempotencyKey: k }),
    };
    const call = calls[key];
    if (call) void run(key, key, call);
  }

  function openDate(key: "schedule" | "reschedule", trigger: HTMLButtonElement | null) {
    areaTriggerRef.current = trigger;
    setMessage(null);
    setDateKey(key);
    setSelectedDate(agencyToday());
    setOpenArea("date");
  }

  function confirmDate() {
    if (submitting) return;
    if (!isValidScheduleDate(selectedDate, today)) {
      setMessage(PAST_DATE_MESSAGE);
      return;
    }
    const call = (k: string) =>
      dateKey === "schedule"
        ? scheduleTaskAction({ ...base, idempotencyKey: k, scheduledDate: selectedDate })
        : rescheduleTaskAction({ ...base, idempotencyKey: k, scheduledDate: selectedDate });
    void run("confirm-date", `${dateKey}:${selectedDate}`, call);
  }

  function openBlock(trigger: HTMLButtonElement | null) {
    areaTriggerRef.current = trigger;
    setMessage(null);
    setBlockerClass("approval");
    setBlockerReason("");
    setOpenArea("block");
  }

  function confirmBlock() {
    if (submitting) return;
    void run("confirm-block", `block:${blockerClass}:${blockerReason.trim()}`, (k) =>
      blockTaskAction({ ...base, idempotencyKey: k, blockerClass, reason: blockerReason })
    );
  }

  function renderActionButton(a: TaskActionDescriptor) {
    const label = TASK_ACTION_LABEL[a.key];
    const common = { key: a.key, type: "button" as const, size: "sm" as const, variant: "ghost" as const, disabled: submitting };
    if (a.kind === "instant") {
      const active = submitting && activeKey === a.key;
      return (
        <Button {...common} loading={active} aria-busy={active || undefined} onClick={() => onInstant(a.key)} aria-label={`${label} “${target.title}”`}>
          {label}
        </Button>
      );
    }
    if (a.kind === "date") {
      const key = a.key === "reschedule" ? "reschedule" : "schedule";
      return (
        <Button {...common} aria-expanded={openArea === "date" && dateKey === key} onClick={(e) => openDate(key, e.currentTarget)} aria-label={`${label} “${target.title}”`}>
          {label}
        </Button>
      );
    }
    return (
      <Button {...common} aria-expanded={openArea === "block"} onClick={(e) => openBlock(e.currentTarget)} aria-label={`${label} “${target.title}”`}>
        {label}
      </Button>
    );
  }

  if (actions.length === 0) return null;

  return (
    <>
      {/* Grows beside the title on desktop; wraps to a full-width line and flows
          across the row on narrow screens (up to six actions must never overflow). */}
      <div className="flex min-w-0 basis-full flex-wrap items-center justify-end gap-1 sm:basis-auto">{actions.map(renderActionButton)}</div>

      {openArea === "date" && (
        <div className="mt-2 basis-full rounded-lg border border-ink-100 bg-ink-50/60 p-3">
          <Label htmlFor={dateId}>{dateKey === "schedule" ? "Schedule date" : "New date"}</Label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              id={dateId}
              ref={dateInputRef}
              type="date"
              value={selectedDate}
              min={today}
              aria-busy={submitting || undefined}
              aria-describedby={feedbackId}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                if (message) setMessage(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeArea();
                }
              }}
              className="sm:max-w-[12rem]"
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={confirmDate} disabled={submitting} loading={submitting && activeKey === "confirm-date"} aria-busy={submitting || undefined} aria-label={`Confirm ${dateKey} “${target.title}”`}>
                Confirm
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={closeArea} aria-label={`Cancel ${dateKey} “${target.title}”`}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {openArea === "block" && (
        <div className="mt-2 basis-full rounded-lg border border-ink-100 bg-ink-50/60 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="sm:w-40">
              <Label htmlFor={classId}>Blocked by</Label>
              <Select id={classId} value={blockerClass} onChange={(e) => setBlockerClass(e.target.value as BlockerClassInput)}>
                {BLOCKER_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c[0].toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="sm:flex-1">
              <Label htmlFor={reasonId}>Reason (optional)</Label>
              <Input
                id={reasonId}
                ref={reasonInputRef}
                value={blockerReason}
                maxLength={200}
                aria-busy={submitting || undefined}
                aria-describedby={feedbackId}
                placeholder="What's it waiting on?"
                onChange={(e) => {
                  setBlockerReason(e.target.value);
                  if (message) setMessage(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    closeArea();
                  }
                }}
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={confirmBlock} disabled={submitting} loading={submitting && activeKey === "confirm-block"} aria-busy={submitting || undefined} aria-label={`Confirm block “${target.title}”`}>
                Block
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={closeArea} aria-label={`Cancel block “${target.title}”`}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {(openArea != null || message) && (
        <div id={feedbackId} className="basis-full" aria-live="polite">
          {message ? <FieldHelp className="text-red-600">{message}</FieldHelp> : null}
        </div>
      )}
    </>
  );
}
