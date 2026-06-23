"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Receipt, Download } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { getSignedUrl } from "@/lib/upload";
import { Card } from "@/components/ui/card";
import type { ClientInvoiceView } from "@/lib/queries";

const STATUS: Record<
  ClientInvoiceView["clientStatus"],
  { label: string; cls: string }
> = {
  outstanding: { label: "Outstanding", cls: "bg-amber-50 text-amber-700" },
  overdue: { label: "Overdue", cls: "bg-red-50 text-red-700" },
  paid: { label: "Paid", cls: "bg-emerald-50 text-emerald-700" },
  cancelled: { label: "Cancelled", cls: "bg-ink-100 text-ink-500" },
};

/** Client-facing, read-only invoice list. View/download only — no payment. */
export function InvoiceList({ invoices }: { invoices: ClientInvoiceView[] }) {
  const [error, setError] = useState<string | null>(null);

  async function download(path: string) {
    try {
      const url = await getSignedUrl(path);
      window.open(url, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the file.");
    }
  }

  const fmtDate = (iso: string | null) =>
    iso ? format(new Date(iso), "d MMM yyyy") : "—";

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
          {error}
        </p>
      )}
      {invoices.map((inv) => {
        const status = STATUS[inv.clientStatus];
        return (
          <Card key={inv.id} className="flex flex-wrap items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-500">
              <Receipt className="h-5 w-5" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-mono text-xs text-ink-400">{inv.invoice_number}</p>
                <span
                  className={cn(
                    "rounded-md px-2 py-0.5 text-xs font-medium",
                    status.cls
                  )}
                >
                  {status.label}
                </span>
              </div>
              <p className="mt-0.5 truncate text-sm font-semibold text-ink-900">
                {inv.title}
              </p>
              <p className="text-xs text-ink-400">
                Issued {fmtDate(inv.issued_at)} · Due {fmtDate(inv.due_at)}
              </p>
            </div>

            <div className="text-right">
              <p className="text-sm font-semibold text-ink-900">
                {formatCurrency(inv.amount, inv.currency)}
              </p>
              <p className="text-[11px] uppercase tracking-wide text-ink-400">
                {inv.currency}
              </p>
            </div>

            {inv.pdf ? (
              <button
                onClick={() => download(inv.pdf!.path)}
                className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
              >
                <Download className="h-3.5 w-3.5" /> Download PDF
              </button>
            ) : (
              <span className="text-xs text-ink-300">PDF not attached</span>
            )}
          </Card>
        );
      })}
    </div>
  );
}
