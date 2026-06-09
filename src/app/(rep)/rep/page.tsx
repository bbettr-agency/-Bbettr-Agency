import type { Metadata } from "next";
import Link from "next/link";
import { format } from "date-fns";
import { Handshake, Wallet, Clock, Plus, CheckCircle2 } from "lucide-react";
import { requireRep } from "@/lib/auth";
import { getRepDeals, getRepStats } from "@/lib/rep-queries";
import { formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DealStatusBadge } from "@/components/ui/status-badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export const metadata: Metadata = { title: "My Deals" };

export default async function RepDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const profile = await requireRep();
  const [{ created }, deals, stats] = await Promise.all([
    searchParams,
    getRepDeals(profile.id),
    getRepStats(profile.id),
  ]);

  return (
    <div className="space-y-6 animate-fade-in">
      {created && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Deal created — an invoice request was sent to the team for approval.
        </div>
      )}

      <PageHeader
        title={`Welcome${profile.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}`}
        description="Close a deal and we'll handle the invoicing."
        actions={
          <Button asChild>
            <Link href="/rep/deals/new">
              <Plus className="h-4 w-4" /> New Deal
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total Deals" value={stats.totalDeals} icon={Handshake} />
        <StatCard
          label="Pipeline Value"
          value={formatCurrency(stats.pipelineValue)}
          icon={Wallet}
        />
        <StatCard
          label="Awaiting Approval"
          value={stats.awaitingApproval}
          icon={Clock}
        />
      </div>

      {deals.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="No deals yet"
          description="Closed a client on a call? Log the deal and we'll generate the invoice."
          action={
            <Button asChild>
              <Link href="/rep/deals/new">
                <Plus className="h-4 w-4" /> New Deal
              </Link>
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Business</TH>
                <TH>Package</TH>
                <TH>Price</TH>
                <TH>Billing</TH>
                <TH>Status</TH>
                <TH>Created</TH>
              </TR>
            </THead>
            <TBody>
              {deals.map((d) => (
                <TR key={d.id}>
                  <TD>
                    <p className="font-semibold text-ink-900">
                      {d.business_name}
                    </p>
                    <p className="text-xs text-ink-400">
                      {d.contact_name ?? d.email ?? "—"}
                    </p>
                  </TD>
                  <TD>{d.package ?? "—"}</TD>
                  <TD>{formatCurrency(d.price)}</TD>
                  <TD className="capitalize">
                    {d.billing_type === "once_off" ? "Once-off" : "Monthly"}
                  </TD>
                  <TD>
                    <DealStatusBadge status={d.status} />
                  </TD>
                  <TD className="whitespace-nowrap text-xs text-ink-500">
                    {format(new Date(d.created_at), "d MMM yyyy")}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
