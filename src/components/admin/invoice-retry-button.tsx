"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { retryInvoiceRequestAction } from "@/app/(admin)/admin/actions";

/**
 * Retry QuickBooks invoicing for an approved request whose invoice creation
 * failed (or was attempted before QBO was connected). Idempotent.
 */
export function InvoiceRetryButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function retry() {
    setError(null);
    startTransition(async () => {
      const res = await retryInvoiceRequestAction(requestId);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button size="sm" variant="outline" loading={pending} onClick={retry}>
        <RefreshCw className="h-4 w-4" /> Retry invoice
      </Button>
      {error && (
        <p className="flex items-center gap-1 text-right text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}
