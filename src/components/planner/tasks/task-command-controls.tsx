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
  eraseTaskAction,
  reassignTaskAction,
} from "@/app/(admin)/admin/planner/tasks/actions";
import { newIdempotencyKey } from "@/lib/planner/tasks/idempotency";
import { clearCommandIntent, commandIntentAfterResult, intentDispositionFor, prepareCommandSubmit, IDLE, type CommandIntent } from "@/lib/planner/tasks/inbox-command-intent";
import { agencyToday, isValidScheduleDate } from "@/lib/planner/tasks/schedule-date";
import { legalActionsFor, primaryActionKey, TASK_ACTION_LABEL, type TaskActionDescriptor, type TaskActionKey } from "@/lib/planner/tasks/task-legality";
import type { TaskActionResult } from "@/lib/planner/tasks/action-result";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldHelp, Select } from "@/components/ui/input";
import { DropdownMenu, type DropdownItem } from "@/components/ui/dropdown-menu";
import { EditTaskDialog } from "./edit-task-dialog";
import type { AssignChoices, TaskCommandTarget } from "./task-command-target";

const CONFLICT_MESSAGE = "This item was already updated. Refreshing…";
const NETWORK_MESSAGE = "Something went wrong. Try again.";
const PAST_DATE_MESSAGE = "Choose today or a future date.";
const BLOCKER_CLASSES = ["person", "client", "approval", "asset", "dependency"] as const;
type BlockerClassInput = (typeof BLOCKER_CLASSES)[number];

/** Server Actions never receive actor/owner/workspace — only the target + command input + the key. */
type Base = { taskId: string; expectedAggregateVersion: number };

export function TaskCommandControls({ target, assign }: { target: TaskCommandTarget; assign?: AssignChoices }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [openArea, setOpenArea] = useState<null | "date" | "block" | "delete" | "assign">(null);
  const [dateKey, setDateKey] = useState<"schedule" | "reschedule">("schedule");
  const [selectedDate, setSelectedDate] = useState("");
  const [blockerClass, setBlockerClass] = useState<BlockerClassInput>("approval");
  const [blockerReason, setBlockerReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null); // which control is in-flight (spinner target)
  const [editOpen, setEditOpen] = useState(false);

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

  function openDelete(trigger: HTMLButtonElement | null) {
    areaTriggerRef.current = trigger;
    setMessage(null);
    setOpenArea("delete");
  }

  function openAssign(trigger: HTMLButtonElement | null) {
    areaTriggerRef.current = trigger;
    setMessage(null);
    setOpenArea("assign");
  }

  /**
   * Reassign to a chosen workspace admin ("Assign to X"). Reuses the idempotency
   * `run()` path (reassign returns the standard TaskActionResult, so VersionConflict
   * → refresh is handled). On success the task may leave this view (reassigned to
   * someone else) — applyResult's router.refresh() re-renders it away.
   */
  function confirmAssign(adminId: string) {
    void run(`assign-${adminId}`, `assign:${adminId}`, (k) => reassignTaskAction({ ...base, idempotencyKey: k, assignedToId: adminId }));
  }

  /**
   * Permanent erase — a separate destructive path (NOT a state-machine command),
   * so it bypasses the idempotency `run()` machinery. The action is idempotent
   * server-side and the button is disabled while submitting, so no key is needed.
   * On success the row is gone; `router.refresh()` removes it from the list.
   */
  async function confirmErase() {
    if (submitting) return;
    setMessage(null);
    setActiveKey("confirm-delete");
    setSubmitting(true);
    try {
      const res = await eraseTaskAction({ taskId: target.taskId });
      if (res.ok) {
        setOpenArea(null);
        router.refresh();
      } else {
        setMessage(res.error); // keep the confirm area open; surface a safe message
      }
    } catch {
      setMessage(NETWORK_MESSAGE);
    } finally {
      setSubmitting(false);
      setActiveKey(null);
    }
  }

  /** Trigger a legal action from the menu (routes to the right instant/inline flow). */
  function onMenuAction(a: TaskActionDescriptor) {
    if (a.kind === "instant") onInstant(a.key);
    else if (a.kind === "date") openDate(a.key === "reschedule" ? "reschedule" : "schedule", null);
    else if (a.kind === "block") openBlock(null);
    else if (a.kind === "delete") openDelete(null);
  }

  if (actions.length === 0) return null;

  // One visible PRIMARY action (Complete for active work, Unblock for waiting);
  // every other legal action moves into the compact Actions ▾ menu, with Edit and
  // (when available) Assign, and the destructive Delete separated at the bottom.
  const primaryKey = primaryActionKey(target.status);
  const primary = primaryKey ? actions.find((a) => a.key === primaryKey) : undefined;
  const menuItems: DropdownItem[] = [];
  for (const a of actions) {
    if (a.key === primaryKey || a.key === "delete") continue;
    menuItems.push({ key: a.key, label: TASK_ACTION_LABEL[a.key], onSelect: () => onMenuAction(a) });
  }
  menuItems.push({ key: "edit", label: "Edit", onSelect: () => setEditOpen(true) });
  if (assign && assign.admins.length > 1) menuItems.push({ key: "assign", label: "Assign", onSelect: () => openAssign(null) });
  const deleteAction = actions.find((a) => a.key === "delete");
  if (deleteAction) {
    menuItems.push({ type: "separator", key: "sep-delete" });
    menuItems.push({ key: "delete", label: "Delete", destructive: true, onSelect: () => openDelete(null) });
  }

  return (
    <>
      {/* Compact cluster — stays out of the title's way (shrink-0), so the task
          content owns the row width. Inline flows still open full-width below. */}
      <div className="flex shrink-0 items-center gap-1.5">
        {primary ? (
          <Button
            type="button"
            size="sm"
            disabled={submitting}
            loading={submitting && activeKey === primary.key}
            aria-busy={submitting && activeKey === primary.key ? true : undefined}
            onClick={() => onInstant(primary.key)}
            aria-label={`${TASK_ACTION_LABEL[primary.key]} “${target.title}”`}
          >
            {TASK_ACTION_LABEL[primary.key]}
          </Button>
        ) : null}
        <DropdownMenu label="Actions" items={menuItems} align="end" disabled={submitting} aria-label={`Actions for “${target.title}”`} />
      </div>

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

      {openArea === "assign" && assign && (
        <div className="mt-2 basis-full rounded-lg border border-ink-100 bg-ink-50/60 p-3">
          <p className="mb-2 text-xs font-medium text-ink-600">Assign to</p>
          <div className="flex flex-wrap items-center gap-2">
            {assign.admins.map((a) => {
              const isMe = a.id === assign.currentAdminId;
              const active = submitting && activeKey === `assign-${a.id}`;
              return (
                <Button
                  key={a.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={submitting}
                  loading={active}
                  aria-busy={active || undefined}
                  onClick={() => confirmAssign(a.id)}
                  aria-label={`Assign “${target.title}” to ${isMe ? "me" : a.name}`}
                >
                  {isMe ? "Me" : a.name}
                </Button>
              );
            })}
            <Button type="button" size="sm" variant="ghost" onClick={closeArea} aria-label={`Cancel assigning “${target.title}”`}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {openArea === "delete" && (
        <div className="mt-2 basis-full rounded-lg border border-red-200 bg-red-50/60 p-3">
          <p className="text-sm font-semibold text-red-800">Delete task?</p>
          <p className="mt-0.5 text-xs text-red-700">
            This task will be removed from all Planner views. Its history will remain stored for recovery.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="danger"
              onClick={confirmErase}
              disabled={submitting}
              loading={submitting && activeKey === "confirm-delete"}
              aria-busy={submitting || undefined}
              aria-describedby={feedbackId}
              aria-label={`Delete task “${target.title}”`}
            >
              Delete Task
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={closeArea} aria-label={`Cancel delete “${target.title}”`}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {(openArea != null || message) && (
        <div id={feedbackId} className="basis-full" aria-live="polite">
          {message ? <FieldHelp className="text-red-600">{message}</FieldHelp> : null}
        </div>
      )}

      <EditTaskDialog open={editOpen} onClose={() => setEditOpen(false)} target={target} />
    </>
  );
}
