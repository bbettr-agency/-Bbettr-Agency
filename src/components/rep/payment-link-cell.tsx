"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

/**
 * Rep-side PayFast payment cell for My Deals (read-only). International deals
 * show the payment status and a "Copy payment link" button while pending; once
 * paid the button is hidden. South African deals show "EFT" (they pay by bank
 * transfer and never get a link). The copied value is the clean portal link
 * (…/pay/<id>) — never the raw signed PayFast params.
 */
export function PaymentLinkCell({
  location,
  requestStatus,
  paymentStatus,
  paymentUrl,
}: {
  location: string;
  requestStatus: string;
  paymentStatus: string | null;
  paymentUrl: string | null;
}) {
  const [copied, setCopied] = useState(false);

  // South African clients pay by EFT — no PayFast link, ever.
  if (location === "south_africa") {
    return <span className="text-ink-400">EFT</span>;
  }

  if (paymentStatus === "paid") {
    return <span className="font-medium text-emerald-700">Paid</span>;
  }

  // Pending with a usable link → status + copy button.
  if (paymentUrl) {
    async function copy() {
      try {
        await navigator.clipboard.writeText(paymentUrl!);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // Clipboard blocked (e.g. insecure context) — leave UI unchanged.
      }
    }
    return (
      <div className="flex items-center gap-2">
        <span className="text-ink-600">Pending</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md border border-ink-200 px-2 py-1 text-xs font-medium text-ink-700 transition hover:bg-ink-50"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy payment link"}
        </button>
      </div>
    );
  }

  // International + invoiced but no link was generated → generation failed.
  if (requestStatus === "invoiced") {
    return (
      <span className="text-amber-700">Payment link unavailable — contact admin</span>
    );
  }

  // Not yet invoiced — no link expected yet.
  return <span className="text-ink-400">—</span>;
}
