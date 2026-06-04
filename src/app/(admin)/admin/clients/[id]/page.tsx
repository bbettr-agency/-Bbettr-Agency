import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import {
  getClient,
  getClientServices,
  getProjectStages,
  getUpdates,
  getReports,
  getFiles,
  getOnboarding,
} from "@/lib/queries";
import { getPortalAccess } from "@/lib/admin-queries";
import { PageHeader } from "@/components/ui/page-header";
import { Avatar } from "@/components/ui/avatar";
import { ClientStatusBadge } from "@/components/ui/status-badge";
import { ClientDetail } from "@/components/admin/client-detail";
import { DangerZone } from "@/components/admin/danger-zone";

const PORTAL_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.bbettragency.com";

export const metadata: Metadata = { title: "Client" };

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const client = await getClient(id);
  if (!client) notFound();

  const [services, stages, updates, reports, files, onboarding, portalAccess] =
    await Promise.all([
      getClientServices(id),
      getProjectStages(id),
      getUpdates(id),
      getReports(id),
      getFiles(id),
      getOnboarding(id),
      getPortalAccess(id),
    ]);

  return (
    <div className="space-y-6 animate-fade-in">
      <Link
        href="/admin/clients"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft className="h-4 w-4" /> Back to clients
      </Link>

      <div className="flex items-center gap-4">
        <Avatar name={client.name} size="lg" />
        <PageHeader
          title={client.name}
          description={client.contact_name ?? client.contact_email ?? undefined}
          actions={<ClientStatusBadge status={client.status} />}
        />
      </div>

      <ClientDetail
        client={client}
        services={services}
        stages={stages}
        updates={updates}
        reports={reports}
        files={files}
        onboarding={onboarding}
        portalUrl={PORTAL_URL}
        portalAccess={portalAccess}
      />

      <DangerZone clientId={client.id} clientName={client.name} />
    </div>
  );
}
