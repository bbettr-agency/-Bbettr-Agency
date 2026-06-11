import type { Metadata } from "next";
import Link from "next/link";
import { format } from "date-fns";
import { Handshake, Plus } from "lucide-react";
import { requireRep } from "@/lib/auth";
import { getRepDealViews, type DealView } from "@/lib/rep-queries";
import { formatCurrency, cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  InvoiceRequestStatusBadge,
  ClientLocationBadge,
} from "@/components/ui/status-badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export const metadata: Metadata = { title: "My Deals" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function matchesFilter(deal: DealView, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "approved")
    return deal.requestStatus === "approved" || deal.requestStatus === "invoiced";
  return deal.requestStatus === filter;
}

export default async function MyDealsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const profile = await requireRep();
  const [{ status }, deals] = await Promise.all([
    searchParams,
    getRepDealViews(profile.id),
  ]);

  const active: FilterKey =
    FILTERS.find((f) => f.key === status)?.key ?? "all";
  const filtered = deals.filter((d) => matchesFilter(d, active));

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="My Deals"
        description="All the deals you've submitted."
        actions={
          <Button asChild>
            <Link href="/rep/deals/new">
              <Plus className="h-4 w-4" /> New Deal
            </Link>
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const count =
            f.key === "all"
              ? deals.length
              : deals.filter((d) => matchesFilter(d, f.key)).length;
          return (
            <Link
              key={f.key}
              href={f.key === "all" ? "/rep/deals" : `/rep/deals?status=${f.key}`}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                active === f.key
                  ? "bg-brand-500 text-white"
                  : "bg-white text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-50"
              )}
            >
              {f.label}
              <span className={cn("ml-1.5", active === f.key ? "text-white/80" : "text-ink-400")}>
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title={active === "all" ? "No deals yet" : "No deals in this filter"}
          description={
            active === "all"
              ? "Log a deal you've closed and we'll handle the invoicing."
              : "Try a different filter."
          }
          action={
            active === "all" ? (
              <Button asChild>
                <Link href="/rep/deals/new">
                  <Plus className="h-4 w-4" /> New Deal
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Client</TH>
                <TH>Location</TH>
                <TH>Package</TH>
                <TH>Value</TH>
                <TH>Billing Type</TH>
                <TH>Status</TH>
                <TH>Invoice</TH>
                <TH>Date</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((d) => (
                <TR key={d.id}>
                  <TD>
                    <p className="font-semibold text-ink-900">{d.business_name}</p>
                    <p className="text-xs text-ink-400">
                      {d.contact_name ?? d.email ?? "—"}
                    </p>
                  </TD>
                  <TD><ClientLocationBadge location={d.client_location} /></TD>
                  <TD>{d.package ?? "—"}</TD>
                  <TD>{formatCurrency(d.price)}</TD>
                  <TD className="capitalize">
                    {d.billing_type === "once_off" ? "Once-off" : "Monthly"}
                  </TD>
                  <TD>
                    <InvoiceRequestStatusBadge status={d.requestStatus} />
                  </TD>
                  <TD className="whitespace-nowrap text-xs">
                    {d.invoiceNumber ? (
                      <span className="font-medium text-ink-700">
                        #{d.invoiceNumber}
                      </span>
                    ) : (
                      <span className="text-ink-400">—</span>
                    )}
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
