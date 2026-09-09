"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { dismissProspectIntakeAction } from "@/app/(admin)/admin/intakes/actions";

/**
 * Admin-only "Dismiss intake" control (P3-A). Rendered only for a SUBMITTED
 * intake. Opens a confirmation modal that names the prospect, then calls the
 * server action (which enforces requireAdmin + the submitted→dismissed guard and
 * never deletes the row). On success returns to the inbox so the dismissed item
 * leaves the Submitted view; it remains under the Dismissed tab.
 */
export function ProspectIntakeDismiss({
  intakeId,
  business,
  contact,
}: {
  intakeId: string;
  business: string | null;
  contact: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const who = business ?? contact ?? "this prospect";

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await dismissProspectIntakeAction(intakeId);
      if (res.ok) {
        setOpen(false);
        router.push("/admin/intakes");
        router.refresh();
      } else {
        setError(
          res.error === "not_submitted"
            ? "This intake is no longer in the submitted state."
            : "Couldn't dismiss just now. Please try again."
        );
      }
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Archive className="h-4 w-4" /> Dismiss
      </Button>

      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title="Dismiss this intake?"
        description={`Dismiss the intake from ${who}. It will move to the Dismissed tab — the submission is kept, nothing is deleted, and no client is created.`}
      >
        {error && (
          <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} loading={pending} disabled={pending}>
            <Archive className="h-4 w-4" /> Dismiss intake
          </Button>
        </div>
      </Modal>
    </>
  );
}
