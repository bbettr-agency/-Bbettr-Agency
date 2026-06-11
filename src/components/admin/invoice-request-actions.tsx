"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  approveInvoiceRequestAction,
  rejectInvoiceRequestAction,
} from "@/app/(admin)/admin/actions";

export function InvoiceRequestActions({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingReject, setConfirmingReject] = useState(false);

  function run(kind: "approve" | "reject") {
    setError(null);
    setBusy(kind);
    startTransition(async () => {
      const res =
        kind === "approve"
          ? await approveInvoiceRequestAction(requestId)
          : await rejectInvoiceRequestAction(requestId);
      setBusy(null);
      // A hard failure (no `ok`) stays put with the error. On success the card
      // moves to History (with its new status), which is the success signal; a
      // soft `error` alongside `ok` (e.g. commission couldn't record) is shown.
      if (res.ok) {
        setConfirmingReject(false);
        if (res.error) setError(res.error);
        router.refresh();
      } else if (res.error) {
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {confirmingReject ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-500">Reject this request?</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setConfirmingReject(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={busy === "reject"}
            onClick={() => run("reject")}
          >
            <X className="h-4 w-4" /> Confirm reject
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setError(null);
              setConfirmingReject(true);
            }}
          >
            <X className="h-4 w-4" /> Reject
          </Button>
          <Button
            size="sm"
            loading={busy === "approve"}
            disabled={pending}
            onClick={() => run("approve")}
          >
            <Check className="h-4 w-4" /> Approve
          </Button>
        </div>
      )}
      {error && (
        <p className="flex items-center gap-1 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      )}
    </div>
  );
}
