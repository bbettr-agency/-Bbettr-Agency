import type { Metadata } from "next";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  Handshake,
  Wallet,
  Clock,
  Plus,
  CheckCircle2,
  XCircle,
  FileCheck2,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { requireRep } from "@/lib/auth";
import { getRepDashboard, type ActivityItem } from "@/lib/rep-queries";
import { formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Dashboard" };

export default async function RepDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const profile = await requireRep();
  const [{ created }, data] = await Promise.all([
    searchParams,
    getRepDashboard(profile.id),
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
        description="Your sales overview."
        actions={
          <Button asChild>
            <Link href="/rep/deals/new">
              <Plus className="h-4 w-4" /> New Deal
            </Link>
          </Button>
        }
      />

      {/* Top stat cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total Deals" value={data.totalDeals} icon={Handshake} />
        <StatCard
          label="Commission Earned"
          value={formatCurrency(data.commissionEarned)}
          icon={Wallet}
        />
        <StatCard
          label="Awaiting Approval"
          value={data.awaitingApproval}
          icon={Clock}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* This Month */}
        <Card>
          <CardHeader>
            <CardTitle>This Month</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Tile label="Deals Closed" value={data.month.dealsClosed} />
            <Tile label="Sales Value" value={formatCurrency(data.month.salesValue)} />
            <Tile label="Commission Earned" value={formatCurrency(data.month.commission)} />
            <Tile label="Awaiting Approval" value={data.month.pending} />
          </CardContent>
        </Card>

        {/* Lifetime */}
        <Card>
          <CardHeader>
            <CardTitle>Lifetime Stats</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Tile label="Total Deals" value={data.lifetime.totalDeals} />
            <Tile label="Total Sales Value" value={formatCurrency(data.lifetime.totalSalesValue)} />
            <Tile
              label="Total Commission Earned"
              value={formatCurrency(data.lifetime.totalCommission)}
              wide
            />
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {data.activity.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-400">
              No activity yet. Log your first deal to get started.
            </p>
          ) : (
            <ul className="space-y-3">
              {data.activity.map((item) => {
                const { icon: Icon, tone } = ACTIVITY_STYLE[item.kind];
                return (
                  <li key={item.id} className="flex items-center gap-3">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="flex-1 text-sm text-ink-700">{item.label}</span>
                    <span className="text-xs text-ink-400">
                      {formatDistanceToNow(new Date(item.at), { addSuffix: true })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const ACTIVITY_STYLE: Record<
  ActivityItem["kind"],
  { icon: LucideIcon; tone: string }
> = {
  submitted: { icon: FileCheck2, tone: "bg-brand-50 text-brand-500" },
  approved: { icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-600" },
  rejected: { icon: XCircle, tone: "bg-red-50 text-red-500" },
  commission: { icon: Receipt, tone: "bg-amber-50 text-amber-600" },
};

function Tile({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string | number;
  wide?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-ink-100 p-3 ${wide ? "col-span-2" : ""}`}>
      <p className="text-xs font-medium text-ink-400">{label}</p>
      <p className="mt-1 text-lg font-bold text-ink-900">{value}</p>
    </div>
  );
}
