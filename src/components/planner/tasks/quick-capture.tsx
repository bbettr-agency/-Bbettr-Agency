"use client";

/**
 * Quick Capture — the zero-friction, keyboard-first front door to the Inbox.
 *
 * Client island. It calls ONLY the `captureTaskAction` Server Action (never any
 * server/privileged module) and derives the idempotency key from the pure
 * capture-intent state machine (a single key per capture SESSION, reused across
 * edits/retries, destroyed on success or Escape — see quick-capture-intent.ts).
 * No optimistic row is inserted; on success it refreshes so the (future C2.1c)
 * list picks up the new task. No toast, no offline queue.
 *
 * Behaviour: autofocus on load · Enter submits · Escape clears the draft and the
 * session key · trimmed, whitespace-only rejected client-side · pending disables
 * re-submission (duplicate Enter cannot double-create) · errors inline, draft +
 * key retained · success clears the draft and keeps focus.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { captureTaskAction } from "@/app/(admin)/admin/planner/tasks/actions";
import { newIdempotencyKey } from "@/lib/planner/tasks/idempotency";
import { beginIntent, clearIntent, intentAfterResult, validateDraft, IDLE, type CaptureIntent } from "@/lib/planner/tasks/quick-capture-intent";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, FieldHelp } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function QuickCapture() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const intentRef = useRef<CaptureIntent>(IDLE);

  function onChange(value: string) {
    setTitle(value);
    if (error) setError(null);
    // A capture session begins on first interaction; the key persists thereafter.
    if (value.trim().length > 0) intentRef.current = beginIntent(intentRef.current, newIdempotencyKey);
  }

  function cancel() {
    // Escape: destroy the session key and clear the draft.
    setTitle("");
    setError(null);
    intentRef.current = clearIntent();
    inputRef.current?.focus();
  }

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (pending) return; // block duplicate submissions while a capture is in flight
    const draft = validateDraft(title);
    if (!draft.ok) {
      setError("Enter a task title.");
      return;
    }
    setError(null);
    intentRef.current = beginIntent(intentRef.current, newIdempotencyKey);
    const idempotencyKey = (intentRef.current as { key: string }).key;

    startTransition(async () => {
      const res = await captureTaskAction({ title: draft.title, idempotencyKey });
      if (res.ok) {
        // applied | accepted_noop | replayed all end this capture session.
        intentRef.current = intentAfterResult(intentRef.current, true);
        setTitle("");
        inputRef.current?.focus(); // stay in the field for rapid capture
        router.refresh();
      } else {
        // Keep the draft + the session key so a retry replays under the same key.
        setError(res.error);
        inputRef.current?.focus();
      }
    });
  }

  return (
    <Card className="border-brand-100 shadow-card-hover">
      <CardContent className="py-5">
        <form onSubmit={submit} className="space-y-2" noValidate>
          <Label htmlFor="quick-capture">Capture a task</Label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <Input
              id="quick-capture"
              ref={inputRef}
              value={title}
              autoFocus
              autoComplete="off"
              disabled={pending}
              placeholder="Capture a task… (press Enter to save)"
              aria-invalid={error ? true : undefined}
              aria-describedby="quick-capture-help"
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancel();
                }
              }}
              className="sm:flex-1"
            />
            <Button type="submit" disabled={pending} loading={pending} className="sm:w-auto">
              {pending ? "Capturing…" : "Capture"}
            </Button>
          </div>
          <div id="quick-capture-help" aria-live="polite">
            {error ? (
              <FieldHelp className="text-red-600">{error}</FieldHelp>
            ) : (
              <FieldHelp>Captures land in the shared agency Inbox. Enter to save, Esc to clear.</FieldHelp>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
