import type { Metadata } from "next";
import { Wallet, CalendarDays, CheckCircle2, Clock } from "lucide-react";
import { requireRep } from "@/lib/auth";
import { getRepEarnings } from "@/lib/rep-queries";
import { formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export const metadata: Metadata = { title: "My Earnings" };

export default async function MyEarningsPage() {
  const profile = await requireRep();
  const earnings = await getRepEarnings(profile.id);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="My Earnings"
        description="Commission you've earned from approved deals."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Commission Earned"
          value={formatCurrency(earnings.totalCommission)}
          icon={Wallet}
        />
        <StatCard
          label="Commission This Month"
          value={formatCurrency(earnings.commissionThisMonth)}
          icon={CalendarDays}
        />
        <StatCard label="Approved Deals" value={earnings.approvedDeals} icon={CheckCircle2} />
        <StatCard
          label="Unpaid Commission"
          value={formatCurrency(earnings.pendingCommission)}
          icon={Clock}
        />
      </div>

      {earnings.months.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No earnings yet"
          description="Once your deals are approved, your monthly commission will appear here."
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Month</TH>
                <TH>Sales Value</TH>
                <TH>Commission Earned</TH>
              </TR>
            </THead>
            <TBody>
              {earnings.months.map((m) => (
                <TR key={m.key}>
                  <TD className="font-semibold text-ink-900">{m.label}</TD>
                  <TD>{formatCurrency(m.salesValue)}</TD>
                  <TD className="font-medium text-emerald-600">
                    {formatCurrency(m.commission)}
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
