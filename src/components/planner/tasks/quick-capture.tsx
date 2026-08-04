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
 * session key · trimmed, whitespace-only rejected client-side · a `submitting`
 * flag (held across the awaited action) disables re-submission (duplicate Enter
 * cannot double-create) · errors inline, draft + key retained · success clears
 * the draft and keeps focus.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { captureTaskAction } from "@/app/(admin)/admin/planner/tasks/actions";
import { newIdempotencyKey } from "@/lib/planner/tasks/idempotency";
import { beginIntent, clearIntent, intentAfterResult, prepareSubmit, validateDraft, IDLE, type CaptureIntent } from "@/lib/planner/tasks/quick-capture-intent";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, FieldHelp } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function QuickCapture() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Explicit submit flag held across the awaited Server Action via try/finally.
  // (React 18's useTransition does NOT keep isPending across the await, so it
  // cannot drive a correct loading/disable affordance — see the C2.1d-2 hardening.)
  const [submitting, setSubmitting] = useState(false);
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

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (submitting) return; // block duplicate submissions while a capture is in flight
    const draft = validateDraft(title);
    if (!draft.ok) {
      setError("Enter a task title.");
      return;
    }
    setError(null);
    // Reuse the key for a same-title retry; mint a NEW key if the title changed
    // after a prior submission attempt (never reuse one key with two payloads).
    intentRef.current = prepareSubmit(intentRef.current, draft.title, newIdempotencyKey);
    const idempotencyKey = intentRef.current.key;

    setSubmitting(true);
    try {
      const res = await captureTaskAction({ title: draft.title, idempotencyKey });
      if (res.ok) {
        // applied | accepted_noop | replayed all end this capture attempt.
        intentRef.current = intentAfterResult(intentRef.current, true);
        setTitle("");
        inputRef.current?.focus(); // stay in the field for rapid capture
        router.refresh();
      } else {
        // Keep the draft + this attempt's key; a same-title retry replays,
        // an edited retry mints a new key via prepareSubmit.
        setError(res.error);
        inputRef.current?.focus();
      }
    } catch {
      // Lost/failed response (network): retain the intent for a safe retry.
      setError("Something went wrong. Press Enter to try again.");
      inputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
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
              // NB: the input is intentionally NOT disabled while submitting —
              // disabling a focused input blurs it, and a later focus() on a
              // disabled element is a no-op, so focus would be lost after each
              // capture. Double-submit is prevented by the `if (submitting) return`
              // guard + the Button's disabled state + the op's idempotency.
              aria-busy={submitting || undefined}
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
            <Button type="submit" disabled={submitting} loading={submitting} aria-busy={submitting || undefined} className="sm:w-auto">
              {submitting ? "Capturing…" : "Capture"}
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
