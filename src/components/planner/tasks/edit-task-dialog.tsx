"use client";

/**
 * Edit Task modal (Title / Description / Priority) — reuses the Portal Modal and
 * dispatches ONLY changed fields through `editTaskAction`, which runs the existing
 * RenameTask / EditDescription / ChangePriority commands (never a raw DB write).
 * A no-op Save (nothing changed) closes without any command/event. Critical
 * priority reveals the required reason field (mirrors the state-machine rule).
 * VersionConflict → refresh (the row moved on); a fresh idempotency key is minted
 * per submit so a same-intent retry after an edit is never rejected.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { editTaskAction } from "@/app/(admin)/admin/planner/tasks/actions";
import { newIdempotencyKey } from "@/lib/planner/tasks/idempotency";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label, Select, FieldHelp } from "@/components/ui/input";
import type { TaskPriority } from "@/lib/database.types";
import type { TaskCommandTarget } from "./task-command-target";

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const norm = (s: string | null | undefined) => (s ?? "").trim();

export function EditTaskDialog({ open, onClose, target }: { open: boolean; onClose: () => void; target: TaskCommandTarget }) {
  const router = useRouter();
  const [title, setTitle] = useState(target.title);
  const [description, setDescription] = useState(target.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(target.priority ?? "normal");
  const [criticalReason, setCriticalReason] = useState(target.criticalReason ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    if (submitting) return;
    const newTitle = title.trim();
    if (newTitle.length === 0) {
      setMessage("Title is required.");
      return;
    }
    if (priority === "critical" && criticalReason.trim().length === 0) {
      setMessage("A reason is required for Critical priority.");
      return;
    }

    // Diff against the rendered values — dispatch only what changed.
    const payload: {
      title?: string;
      description?: string | null;
      priority?: TaskPriority;
      criticalReason?: string | null;
    } = {};
    if (newTitle !== norm(target.title)) payload.title = newTitle;
    if (norm(description) !== norm(target.description)) payload.description = description.trim().length > 0 ? description : null;
    const priorityChanged = priority !== (target.priority ?? "normal") || (priority === "critical" && criticalReason.trim() !== norm(target.criticalReason));
    if (priorityChanged) {
      payload.priority = priority;
      if (priority === "critical") payload.criticalReason = criticalReason.trim();
    }

    // Nothing changed → no round-trip, no events.
    if (Object.keys(payload).length === 0) {
      onClose();
      return;
    }

    setSubmitting(true);
    setMessage(null);
    try {
      const res = await editTaskAction({
        taskId: target.taskId,
        expectedAggregateVersion: target.aggregateVersion,
        idempotencyKey: newIdempotencyKey(),
        ...payload,
      });
      if (res.ok) {
        onClose();
        router.refresh();
      } else if (res.code === "VersionConflict") {
        setMessage("This task was updated elsewhere. Refreshing…");
        router.refresh();
      } else {
        setMessage(res.error);
      }
    } catch {
      setMessage("Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit task" description="Correct the title, description or priority.">
      <div className="space-y-4">
        <div>
          <Label htmlFor="edit-title">Title</Label>
          <Input
            id="edit-title"
            value={title}
            maxLength={500}
            autoFocus
            onChange={(e) => {
              setTitle(e.target.value);
              if (message) setMessage(null);
            }}
          />
        </div>
        <div>
          <Label htmlFor="edit-description">Description (optional)</Label>
          <Textarea
            id="edit-description"
            value={description}
            rows={3}
            maxLength={2000}
            placeholder="Add more detail…"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="sm:w-40">
            <Label htmlFor="edit-priority">Priority</Label>
            <Select
              id="edit-priority"
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value as TaskPriority);
                if (message) setMessage(null);
              }}
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          {priority === "critical" ? (
            <div className="sm:flex-1">
              <Label htmlFor="edit-critical-reason">Why is this critical?</Label>
              <Input
                id="edit-critical-reason"
                value={criticalReason}
                maxLength={200}
                placeholder="Reason (required)"
                onChange={(e) => {
                  setCriticalReason(e.target.value);
                  if (message) setMessage(null);
                }}
              />
            </div>
          ) : null}
        </div>
        {message ? <FieldHelp className="text-red-600">{message}</FieldHelp> : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={submitting} loading={submitting} aria-busy={submitting || undefined}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
