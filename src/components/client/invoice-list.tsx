"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Receipt, Download, CheckCircle2, Wallet } from "lucide-react";
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

const isDue = (i: ClientInvoiceView) =>
  i.clientStatus === "outstanding" || i.clientStatus === "overdue";

/**
 * Client-facing, read-only invoice list. View/download only — no payment.
 * Status-led presentation: what needs payment leads (with a per-currency
 * summary strip), settled history recedes. Purely presentational — same data,
 * same statuses, same actions as before.
 */
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

  const needsPayment = invoices.filter(isDue);
  const history = invoices.filter((i) => !isDue(i));
  const overdueCount = needsPayment.filter(
    (i) => i.clientStatus === "overdue"
  ).length;

  // Per-currency outstanding totals — never a mixed-currency sum.
  const dueByCurrency: Record<string, number> = {};
  for (const i of needsPayment) {
    dueByCurrency[i.currency] = (dueByCurrency[i.currency] ?? 0) + i.amount;
  }
  const dueEntries = Object.entries(dueByCurrency).sort(([a], [b]) =>
    a === "ZAR" ? -1 : b === "ZAR" ? 1 : a.localeCompare(b)
  );

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Summary strip — outstanding per currency, or the all-settled moment */}
      {needsPayment.length > 0 ? (
        <Card
          className={cn(
            "flex flex-wrap items-center gap-x-6 gap-y-2 p-4",
            overdueCount > 0 ? "border-red-200" : "border-amber-200"
          )}
        >
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
              overdueCount > 0
                ? "bg-red-50 text-red-600"
                : "bg-amber-50 text-amber-600"
            )}
          >
            <Wallet className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-400">
              Outstanding
            </p>
            <p className="flex flex-wrap items-baseline gap-x-3 font-display text-lg font-bold text-ink-900">
              {dueEntries.map(([currency, amount]) => (
                <span key={currency}>{formatCurrency(amount, currency)}</span>
              ))}
            </p>
          </div>
          <p className="text-sm text-ink-500">
            {needsPayment.length} invoice{needsPayment.length === 1 ? "" : "s"}
            {overdueCount > 0 && (
              <span className="font-medium text-red-600">
                {" "}
                · {overdueCount} overdue
              </span>
            )}
          </p>
        </Card>
      ) : (
        <Card className="flex items-center gap-3 border-emerald-200 bg-emerald-50/40 p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-900">
              You&apos;re all settled
            </p>
            <p className="text-sm text-ink-500">
              No outstanding invoices on your account.
            </p>
          </div>
        </Card>
      )}

      {/* Needs payment — leads visually */}
      {needsPayment.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-ink-900">Needs payment</h2>
          {needsPayment.map((inv) => (
            <InvoiceRow key={inv.id} inv={inv} emphasis onDownload={download} />
          ))}
        </section>
      )}

      {/* History — settled, lower priority */}
      {history.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-ink-500">History</h2>
          {history.map((inv) => (
            <InvoiceRow key={inv.id} inv={inv} onDownload={download} />
          ))}
        </section>
      )}

      <p className="text-center text-xs text-ink-400">
        Questions about an invoice? Your account manager is one message away.
      </p>
    </div>
  );
}

function InvoiceRow({
  inv,
  emphasis = false,
  onDownload,
}: {
  inv: ClientInvoiceView;
  emphasis?: boolean;
  onDownload: (path: string) => void;
}) {
  const status = STATUS[inv.clientStatus];
  const overdue = inv.clientStatus === "overdue";
  const paid = inv.clientStatus === "paid";
  const fmtDate = (iso: string | null) =>
    iso ? format(new Date(iso), "d MMM yyyy") : "—";

  return (
    <Card
      className={cn(
        "flex flex-wrap items-center gap-3 p-4",
        emphasis && (overdue ? "border-red-200" : "border-amber-200")
      )}
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
          paid
            ? "bg-emerald-50 text-emerald-500"
            : emphasis
              ? overdue
                ? "bg-red-50 text-red-500"
                : "bg-amber-50 text-amber-600"
              : "bg-brand-50 text-brand-500"
        )}
      >
        {paid ? (
          <CheckCircle2 className="h-5 w-5" />
        ) : (
          <Receipt className="h-5 w-5" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-mono text-xs text-ink-400">{inv.invoice_number}</p>
          <span
            className={cn("rounded-md px-2 py-0.5 text-xs font-medium", status.cls)}
          >
            {status.label}
          </span>
        </div>
        <p
          className={cn(
            "mt-0.5 truncate text-sm font-semibold",
            emphasis ? "text-ink-900" : "text-ink-700"
          )}
        >
          {inv.title}
        </p>
        <p className="text-xs text-ink-400">
          Issued {fmtDate(inv.issued_at)} · Due {fmtDate(inv.due_at)}
        </p>
      </div>

      <div className="text-right">
        <p
          className={cn(
            "font-semibold",
            emphasis ? "text-base text-ink-900" : "text-sm text-ink-700"
          )}
        >
          {formatCurrency(inv.amount, inv.currency)}
        </p>
        <p className="text-[11px] uppercase tracking-wide text-ink-400">
          {inv.currency}
        </p>
      </div>

      {inv.pdf ? (
        <button
          onClick={() => onDownload(inv.pdf!.path)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-2 text-xs font-medium text-ink-700 hover:bg-ink-50"
        >
          <Download className="h-3.5 w-3.5" /> Download PDF
        </button>
      ) : (
        <span className="text-xs text-ink-300">PDF not attached</span>
      )}
    </Card>
  );
}
