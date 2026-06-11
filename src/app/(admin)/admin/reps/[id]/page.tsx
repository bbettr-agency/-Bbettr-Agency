import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft, Mail, Phone, Percent, Wallet, Clock } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getRepDetail } from "@/lib/admin-queries";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { DealStatusBadge } from "@/components/ui/status-badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { RepAccessControl } from "@/components/admin/rep-access-control";
import { RepDangerZone } from "@/components/admin/rep-danger-zone";
import { Handshake } from "lucide-react";

export const metadata: Metadata = { title: "Rep" };

export default async function RepDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const rep = await getRepDetail(id);
  if (!rep) notFound();

  return (
    <div className="space-y-6 animate-fade-in">
      <Link
        href="/admin/reps"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft className="h-4 w-4" /> Back to reps
      </Link>

      <div className="flex items-center gap-4">
        <Avatar name={rep.name} size="lg" />
        <PageHeader
          title={rep.name}
          description={rep.email ?? undefined}
          actions={
            rep.active ? (
              <Badge tone="success" dot>Active</Badge>
            ) : (
              <Badge tone="neutral" dot>Inactive</Badge>
            )
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Deals" value={rep.dealsCount} icon={Handshake} />
        <StatCard label="Pending Approval" value={rep.pendingRequests} icon={Clock} />
        <StatCard label="Commission Total" value={formatCurrency(rep.commissionTotal)} icon={Wallet} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row icon={Mail} label="Email" value={rep.email} />
            <Row icon={Phone} label="Phone" value={rep.phone} />
            <Row icon={Percent} label="Commission" value={formatPercent(rep.commissionRate, 1)} />
            <Row
              icon={Clock}
              label="Last login"
              value={rep.lastSignInAt ? `${format(new Date(rep.lastSignInAt), "d MMM yyyy, HH:mm")}` : "Never logged in"}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Access</CardTitle>
          </CardHeader>
          <CardContent>
            <RepAccessControl repId={rep.id} active={rep.active} />
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Deals</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rep.deals.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={Handshake} title="No deals yet" description="This rep hasn't logged any deals." />
            </div>
          ) : (
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
                {rep.deals.map((d) => (
                  <TR key={d.id}>
                    <TD>
                      <p className="font-semibold text-ink-900">{d.business_name}</p>
                      <p className="text-xs text-ink-400">{d.contact_name ?? d.email ?? "—"}</p>
                    </TD>
                    <TD>{d.package ?? "—"}</TD>
                    <TD>{formatCurrency(d.price)}</TD>
                    <TD className="capitalize">{d.billing_type === "once_off" ? "Once-off" : "Monthly"}</TD>
                    <TD><DealStatusBadge status={d.status} /></TD>
                    <TD className="whitespace-nowrap text-xs text-ink-500">
                      {format(new Date(d.created_at), "d MMM yyyy")}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <RepDangerZone repId={rep.id} repName={rep.name} />
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-50 text-ink-400">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="text-xs text-ink-400">{label}</p>
        <p className="text-sm font-medium text-ink-900">{value ?? "—"}</p>
      </div>
    </div>
  );
}
