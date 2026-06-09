import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Headset } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getAllReps } from "@/lib/admin-queries";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export const metadata: Metadata = { title: "Reps" };

export default async function RepsPage() {
  await requireAdmin();
  const reps = await getAllReps();

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Sales Reps"
        description={`${reps.length} rep${reps.length === 1 ? "" : "s"}.`}
        actions={
          <Button asChild>
            <Link href="/admin/reps/new">
              <Plus className="h-4 w-4" /> Create Rep
            </Link>
          </Button>
        }
      />

      {reps.length === 0 ? (
        <EmptyState
          icon={Headset}
          title="No reps yet"
          description="Add a sales rep so they can log deals and raise invoice requests."
          action={
            <Button asChild>
              <Link href="/admin/reps/new">
                <Plus className="h-4 w-4" /> Create Rep
              </Link>
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Rep</TH>
                <TH>Commission</TH>
                <TH>Status</TH>
                <TH>Deals</TH>
                <TH>Pending</TH>
                <TH>Commission Total</TH>
              </TR>
            </THead>
            <TBody>
              {reps.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link
                      href={`/admin/reps/${r.id}`}
                      className="flex items-center gap-3"
                    >
                      <Avatar name={r.name} size="sm" />
                      <div>
                        <p className="font-semibold text-ink-900">{r.name}</p>
                        <p className="text-xs text-ink-400">{r.email ?? "—"}</p>
                      </div>
                    </Link>
                  </TD>
                  <TD>{formatPercent(r.commissionRate, 1)}</TD>
                  <TD>
                    {r.active ? (
                      <Badge tone="success" dot>Active</Badge>
                    ) : (
                      <Badge tone="neutral" dot>Inactive</Badge>
                    )}
                  </TD>
                  <TD>{r.dealsCount}</TD>
                  <TD>{r.pendingRequests}</TD>
                  <TD>{formatCurrency(r.commissionTotal)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
