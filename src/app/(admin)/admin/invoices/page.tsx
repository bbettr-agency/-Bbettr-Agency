import type { Metadata } from "next";
import { format } from "date-fns";
import { Receipt } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getInvoiceRequests } from "@/lib/admin-queries";
import { formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { InvoiceRequestStatusBadge } from "@/components/ui/status-badge";
import { InvoiceRequestActions } from "@/components/admin/invoice-request-actions";

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
        description="Review and approve invoice requests raised by sales reps. Approving records the rep's commission; QuickBooks invoicing is configured separately."
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
  } | null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-ink-900">
              {deal?.business_name ?? "Deal"}
            </p>
            <InvoiceRequestStatusBadge status={request.status} />
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
        </div>
        {actionable && <InvoiceRequestActions requestId={request.id} />}
      </CardContent>
    </Card>
  );
}
