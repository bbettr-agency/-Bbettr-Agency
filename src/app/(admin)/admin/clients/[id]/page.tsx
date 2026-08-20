import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import {
  getClient,
  getClientServices,
  getProjectStages,
  getUpdates,
  getReports,
  getFiles,
  getOnboarding,
  getClientContracts,
  getUpdateReactions,
} from "@/lib/queries";
import {
  getPortalAccess,
  getTeamMembers,
  getClientActivity,
  getClientDealLink,
  getLinkableDeals,
  getClientBilling,
  getClientUpdateQuestions,
} from "@/lib/admin-queries";
import { getBillingDetails } from "@/lib/billing-details-queries";
import { ClientDetail } from "@/components/admin/client-detail";

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

  const [
    services,
    stages,
    updates,
    reports,
    files,
    onboarding,
    portalAccess,
    teamMembers,
    activity,
    contracts,
    dealLink,
    linkableDeals,
    billing,
    updateQuestions,
    billingDetails,
  ] = await Promise.all([
    getClientServices(id),
    getProjectStages(id),
    getUpdates(id),
    getReports(id),
    getFiles(id),
    getOnboarding(id),
    getPortalAccess(id),
    getTeamMembers(),
    getClientActivity(id),
    getClientContracts(id),
    getClientDealLink(id),
    getLinkableDeals(),
    getClientBilling(id),
    getClientUpdateQuestions(id),
    getBillingDetails(id),
  ]);

  // Reaction counts depend on the fetched update ids (read-only for admins).
  const updateReactions = await getUpdateReactions(updates.map((u) => u.id));

  return (
    // The workspace renders its own sticky, breadcrumb-shaped client header
    // (Clients / name · status · services · portal state) — no static header.
    <div className="space-y-6 animate-fade-in">
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
        teamMembers={teamMembers}
        activity={activity}
        contracts={contracts}
        dealLink={dealLink}
        linkableDeals={linkableDeals}
        billing={billing}
        billingDetails={billingDetails}
        updateReactions={updateReactions}
        updateQuestions={updateQuestions}
      />
    </div>
  );
}
