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

  function run(kind: "approve" | "reject") {
    setError(null);
    setBusy(kind);
    startTransition(async () => {
      const res =
        kind === "approve"
          ? await approveInvoiceRequestAction(requestId)
          : await rejectInvoiceRequestAction(requestId);
      setBusy(null);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          loading={busy === "reject"}
          disabled={pending}
          onClick={() => run("reject")}
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
      {error && (
        <p className="flex items-center gap-1 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      )}
    </div>
  );
}
