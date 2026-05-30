import type { Metadata } from "next";
import Link from "next/link";
import { format } from "date-fns";
import { BarChart3 } from "lucide-react";
import { getAllReportsGlobal } from "@/lib/admin-queries";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export const metadata: Metadata = { title: "All Reports" };

export default async function AdminReportsPage() {
  const reports = await getAllReportsGlobal();

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Reports"
        description="Every monthly report across all clients. Create reports from a client's page."
      />

      {reports.length > 0 ? (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Client</TH>
                <TH>Month</TH>
                <TH>Ad Spend</TH>
                <TH>Leads</TH>
                <TH>Cost / Lead</TH>
                <TH>Conv. Rate</TH>
              </TR>
            </THead>
            <TBody>
              {reports.map((r) => {
                const clientName =
                  (r.clients as { name: string } | null)?.name ?? "Client";
                return (
                  <TR key={r.id}>
                    <TD>
                      <Link
                        href={`/admin/clients/${r.client_id}`}
                        className="font-semibold text-ink-900 hover:text-brand-600"
                      >
                        {clientName}
                      </Link>
                    </TD>
                    <TD className="whitespace-nowrap">
                      {format(new Date(r.reporting_month), "MMM yyyy")}
                    </TD>
                    <TD>{formatCurrency(r.ad_spend)}</TD>
                    <TD>{formatNumber(r.leads_generated)}</TD>
                    <TD>{formatCurrency(r.cost_per_lead)}</TD>
                    <TD>{formatPercent(r.conversion_rate)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      ) : (
        <EmptyState
          icon={BarChart3}
          title="No reports yet"
          description="Open a client and create their first monthly report."
        />
      )}
    </div>
  );
}
