import type { Metadata } from "next";
import { format } from "date-fns";
import { Receipt } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getInvoiceRequests } from "@/lib/admin-queries";
import { formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  InvoiceRequestStatusBadge,
  ClientLocationBadge,
} from "@/components/ui/status-badge";
import { InvoiceRequestActions } from "@/components/admin/invoice-request-actions";
import { InvoiceRetryButton } from "@/components/admin/invoice-retry-button";

export const metadata: Metadata = { title: "Invoice Requests" };

export default async function InvoiceRequestsPage() {
  await requireAdmin();
  const requests = await getInvoiceRequests();
  const pending = requests.filter((r) => r.status === "pending");
  const actioned = requests.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Invoice Requests"
        description="Review and approve invoice requests raised by sales reps. Approving records the rep's commission and raises the invoice in QuickBooks (connect it under Integrations)."
      />

      {requests.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No invoice requests"
          description="When a rep logs a deal, its invoice request appears here for approval."
        />
      ) : (
        <div className="space-y-6">
          <Section title={`Pending approval (${pending.length})`}>
            {pending.length === 0 ? (
              <p className="px-1 py-4 text-sm text-ink-400">
                Nothing awaiting approval.
              </p>
            ) : (
              pending.map((r) => <RequestCard key={r.id} request={r} actionable />)
            )}
          </Section>

          {actioned.length > 0 && (
            <Section title="History">
              {actioned.map((r) => (
                <RequestCard key={r.id} request={r} />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-ink-700">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

type RequestRow = Awaited<ReturnType<typeof getInvoiceRequests>>[number];

function RequestCard({
  request,
  actionable = false,
}: {
  request: RequestRow;
  actionable?: boolean;
}) {
  const deal = request.deals as {
    business_name: string;
    contact_name: string | null;
    email: string | null;
    package: string | null;
    client_location: import("@/lib/database.types").ClientLocation;
  } | null;

  // Approved but not yet invoiced in QuickBooks → offer a retry.
  const needsInvoice =
    request.status === "approved" && !request.quickbooks_invoice_id;

  const emailStatus = request.quickbooks_email_status;
  const emailTone =
    emailStatus === "sent"
      ? "bg-emerald-50 text-emerald-700"
      : emailStatus === "failed"
        ? "bg-amber-50 text-amber-700"
        : "bg-ink-100 text-ink-500";
  const emailLabel =
    emailStatus === "sent"
      ? "Email sent"
      : emailStatus === "failed"
        ? "Email failed"
        : emailStatus === "no_email"
          ? "No client email"
          : null;

  // Show diagnostics once any QuickBooks attempt has been made.
  const hasQboActivity =
    Boolean(request.quickbooks_invoice_id) ||
    Boolean(request.quickbooks_last_attempt_at) ||
    Boolean(request.error);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-ink-900">
                {deal?.business_name ?? "Deal"}
              </p>
              <InvoiceRequestStatusBadge status={request.status} />
              {deal && <ClientLocationBadge location={deal.client_location} />}
              {request.quickbooks_invoice_number && (
                <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                  Invoice #{request.quickbooks_invoice_number}
                </span>
              )}
              {emailLabel && (
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-medium ${emailTone}`}
                >
                  {emailLabel}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-ink-500">
              {deal?.package ?? "—"} ·{" "}
              <span className="font-medium text-ink-700">
                {formatCurrency(request.amount)}
              </span>{" "}
              · {request.billing_type === "once_off" ? "Once-off" : "Monthly"}
            </p>
            <p className="mt-0.5 text-xs text-ink-400">
              {deal?.contact_name ?? deal?.email ?? "—"} ·{" "}
              {format(new Date(request.created_at), "d MMM yyyy")}
            </p>
            {request.error && (
              <p className="mt-1.5 text-xs text-amber-700">
                QuickBooks: {request.error}
              </p>
            )}
          </div>
          {actionable ? (
            <InvoiceRequestActions requestId={request.id} />
          ) : needsInvoice ? (
            <InvoiceRetryButton requestId={request.id} />
          ) : null}
        </div>

        {hasQboActivity && (
          <details className="rounded-lg border border-ink-100 bg-ink-50/60 text-xs">
            <summary className="cursor-pointer select-none px-3 py-2 font-medium text-ink-600">
              QuickBooks details
            </summary>
            <dl className="grid gap-x-6 gap-y-1.5 px-3 pb-3 sm:grid-cols-2">
              <DebugRow label="QBO Customer ID" value={request.quickbooks_customer_id} />
              <DebugRow label="QBO Invoice ID" value={request.quickbooks_invoice_id} />
              <DebugRow
                label="QBO Invoice Number"
                value={request.quickbooks_invoice_number}
              />
              <DebugRow label="QBO Realm ID" value={request.quickbooks_realm_id} />
              <DebugRow
                label="Invoice Created At"
                value={
                  request.invoiced_at
                    ? format(new Date(request.invoiced_at), "d MMM yyyy, HH:mm")
                    : null
                }
              />
              <DebugRow
                label="Email Status"
                value={request.quickbooks_email_status}
              />
              <DebugRow
                label="Emailed At"
                value={
                  request.quickbooks_emailed_at
                    ? format(new Date(request.quickbooks_emailed_at), "d MMM yyyy, HH:mm")
                    : null
                }
              />
              <DebugRow
                label="Last Retry Attempt"
                value={
                  request.quickbooks_last_attempt_at
                    ? format(
                        new Date(request.quickbooks_last_attempt_at),
                        "d MMM yyyy, HH:mm"
                      )
                    : null
                }
              />
              <DebugRow label="Last QuickBooks Error" value={request.error} wide />
            </dl>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function DebugRow({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string | null;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-ink-400">{label}</dt>
      <dd className="break-words font-mono text-ink-700">{value ?? "—"}</dd>
    </div>
  );
}
