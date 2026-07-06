import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Users, CheckCircle2 } from "lucide-react";
import { getAllClients } from "@/lib/admin-queries";
import { getService } from "@/lib/services";
import { computeProgress } from "@/lib/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ClientsExplorer, type ClientRow } from "@/components/admin/clients-explorer";

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

  // Precompute a plain, serializable view model server-side (progress + service
  // names) so the interactive table can search/filter/sort in-browser without
  // any extra queries or server round-trips.
  const rows: ClientRow[] = clients.map((c) => ({
    id: c.id,
    name: c.name,
    contactEmail: c.contact_email,
    status: c.status,
    onboardingDone: c.onboarding_done,
    onboardingTotal: c.onboarding_total,
    progress: computeProgress(c.stages),
    serviceNames: c.services.map((s) => getService(s).name),
    lastUpdate: c.last_update,
    lastReport: c.last_report,
  }));

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

      {rows.length === 0 ? (
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
        <ClientsExplorer rows={rows} />
      )}
    </div>
  );
}
