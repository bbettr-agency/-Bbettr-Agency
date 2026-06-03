import type { Metadata } from "next";
import Link from "next/link";
import { format } from "date-fns";
import { Plus, Users, CheckCircle2 } from "lucide-react";
import { getAllClients } from "@/lib/admin-queries";
import { getService } from "@/lib/services";
import { computeProgress } from "@/lib/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { ClientStatusBadge } from "@/components/ui/status-badge";
import { ProgressBar } from "@/components/ui/progress-tracker";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const [{ deleted }, clients] = await Promise.all([
    searchParams,
    getAllClients(),
  ]);

  return (
    <div className="space-y-6 animate-fade-in">
      {deleted && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Client successfully deleted.
        </div>
      )}

      <PageHeader
        title="Clients"
        description={`${clients.length} client${clients.length === 1 ? "" : "s"} in your portfolio.`}
        actions={
          <Button asChild>
            <Link href="/admin/clients/new">
              <Plus className="h-4 w-4" /> Create Client
            </Link>
          </Button>
        }
      />

      {clients.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No clients yet"
          description="Create your first client to begin onboarding them onto the portal."
          action={
            <Button asChild>
              <Link href="/admin/clients/new">
                <Plus className="h-4 w-4" /> Create Client
              </Link>
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Client</TH>
                <TH>Services</TH>
                <TH>Status</TH>
                <TH>Onboarding</TH>
                <TH>Progress</TH>
                <TH>Last Update</TH>
                <TH>Last Report</TH>
              </TR>
            </THead>
            <TBody>
              {clients.map((c) => {
                const progress = computeProgress(c.stages);
                return (
                  <TR key={c.id}>
                    <TD>
                      <Link
                        href={`/admin/clients/${c.id}`}
                        className="flex items-center gap-3"
                      >
                        <Avatar name={c.name} size="sm" />
                        <div>
                          <p className="font-semibold text-ink-900">{c.name}</p>
                          <p className="text-xs text-ink-400">
                            {c.contact_email ?? "—"}
                          </p>
                        </div>
                      </Link>
                    </TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {c.services.length > 0 ? (
                          c.services.map((s) => (
                            <span
                              key={s}
                              className="rounded-md bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600"
                            >
                              {getService(s).name}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-ink-400">—</span>
                        )}
                      </div>
                    </TD>
                    <TD>
                      <ClientStatusBadge status={c.status} />
                    </TD>
                    <TD className="whitespace-nowrap text-sm">
                      {c.onboarding_done}/{c.onboarding_total || 0}
                    </TD>
                    <TD>
                      <div className="flex w-28 items-center gap-2">
                        <ProgressBar value={progress} />
                        <span className="text-xs font-medium text-ink-500">
                          {progress}%
                        </span>
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-ink-500">
                      {c.last_update
                        ? format(new Date(c.last_update), "d MMM yyyy")
                        : "—"}
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-ink-500">
                      {c.last_report
                        ? format(new Date(c.last_report), "MMM yyyy")
                        : "—"}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
