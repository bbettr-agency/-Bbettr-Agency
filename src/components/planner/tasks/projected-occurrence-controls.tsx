"use client";

/**
 * Per-row controls for a PROJECTED recurring occurrence (one derived from the
 * recurrence definition, with no task row yet). It deliberately exposes ONLY a safe
 * "Complete" — every other lifecycle action (start / reschedule / block / edit /
 * delete / assign) needs a real aggregate and is withheld until the occurrence is
 * materialised. Completing runs the materialise-then-complete server action, which
 * is admin-authorised, idempotent (the permanent (definition, slot) unique key), and
 * fail-safe (never a false "completed"). A stable idempotency key per occurrence
 * means a retry after a hiccup can't double-create.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { completeProjectedOccurrenceAction } from "@/app/(admin)/admin/planner/tasks/actions";
import { newIdempotencyKey } from "@/lib/planner/tasks/idempotency";
import { Button } from "@/components/ui/button";
import { FieldHelp } from "@/components/ui/input";

const CONFLICT_MESSAGE = "This item was already updated. Refreshing…";
const NETWORK_MESSAGE = "Something went wrong. Try again.";

export function ProjectedOccurrenceControls({ definitionId, slot, title }: { definitionId: string; slot: string; title: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const keyRef = useRef<string>(newIdempotencyKey()); // one stable key for this occurrence

  async function complete() {
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await completeProjectedOccurrenceAction({ definitionId, slot, idempotencyKey: keyRef.current });
      if (res.ok) {
        router.refresh();
      } else if (res.code === "VersionConflict") {
        setMessage(CONFLICT_MESSAGE);
        router.refresh();
      } else {
        setMessage(res.error);
      }
    } catch {
      setMessage(NETWORK_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  }

  const feedbackId = `projected-controls-feedback-${definitionId}-${slot}`;
  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          disabled={submitting}
          loading={submitting}
          aria-busy={submitting || undefined}
          aria-describedby={message ? feedbackId : undefined}
          onClick={complete}
          aria-label={`Complete “${title}”`}
        >
          Complete
        </Button>
      </div>
      {message ? (
        <div id={feedbackId} className="basis-full" aria-live="polite">
          <FieldHelp className="text-red-600">{message}</FieldHelp>
        </div>
      ) : null}
    </>
  );
}
