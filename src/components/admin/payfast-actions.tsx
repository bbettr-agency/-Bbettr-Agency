"use client";

import { useState, useTransition } from "react";
import { Copy, Check, Link2, BadgeCheck } from "lucide-react";
import {
  generatePayfastLinkAction,
  markPayfastPaidAction,
} from "@/app/(admin)/admin/actions";
import { Button } from "@/components/ui/button";

/**
 * Admin PayFast controls for an international invoice request: copy the payment
 * link, mark it paid (V1 manual confirmation), or generate the link if it
 * failed at approval time. Renders nothing-but-a-generate-button when no link
 * exists yet.
 */
export function PayfastActions({
  requestId,
  status,
  paymentUrl,
}: {
  requestId: string;
  status: string | null;
  paymentUrl: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tone =
    status === "paid"
      ? "bg-emerald-50 text-emerald-700"
      : status === "failed" || status === "cancelled"
        ? "bg-amber-50 text-amber-700"
        : "bg-ink-100 text-ink-600";

  function run(fn: () => Promise<{ ok?: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
    });
  }

  async function copy() {
    if (!paymentUrl) return;
    try {
      await navigator.clipboard.writeText(paymentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy the link.");
    }
  }

  if (!paymentUrl) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          variant="outline"
          size="sm"
          loading={pending}
          onClick={() => run(() => generatePayfastLinkAction(requestId))}
        >
          <Link2 className="h-4 w-4" /> Generate PayFast link
        </Button>
        {error && <span className="text-xs text-amber-700">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${tone}`}>
          PayFast: {status ?? "pending"}
        </span>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
        {status !== "paid" && (
          <Button
            variant="outline"
            size="sm"
            loading={pending}
            onClick={() => run(() => markPayfastPaidAction(requestId))}
          >
            <BadgeCheck className="h-4 w-4" /> Mark paid
          </Button>
        )}
      </div>
      {error && <span className="text-xs text-amber-700">{error}</span>}
    </div>
  );
}
