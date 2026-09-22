import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Route } from "lucide-react";
import { requireClient } from "@/lib/auth";
import {
  getPortalClient,
  getClientServices,
  getProjectStages,
  getUpdates,
  getOnboarding,
  getOpenActionItems,
  isOnboardingComplete,
} from "@/lib/queries";
import { canonicalProjectState } from "@/lib/project-state";
import { buildClientOverview, type OverviewServiceInput } from "@/lib/client-overview";
import { computeReadiness } from "@/lib/readiness";
import {
  resolveServiceOperational,
  clientOperationalLabel,
} from "@/lib/service-operational-state";
import { OverviewAttention } from "@/components/client/overview/attention";
import { ProjectStateHeader } from "@/components/client/overview/project-state-header";
import { LatestUpdate } from "@/components/client/overview/latest-update";
import { ServicesSummary } from "@/components/client/overview/services-summary";
import { ProjectJourney } from "@/components/client/project-journey";
import { SuccessManagerCard } from "@/components/client/success-manager-card";
import { IntakePending } from "@/components/client/intake-pending";
import { resolveSuccessManager } from "@/lib/success-manager";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SeenMarker } from "@/components/shared/seen-marker";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const profile = await requireClient();
  const [client, services, stages, updates, onboarding, actionItems] =
    await Promise.all([
      getPortalClient(profile.client_id),
      getClientServices(profile.client_id),
      getProjectStages(profile.client_id),
      getUpdates(profile.client_id, 1),
      getOnboarding(profile.client_id),
      getOpenActionItems(profile.client_id),
    ]);

  // New intake clients see a calm holding panel until their onboarding opens.
  // Legacy + existing clients get the full dashboard. Access gate is unchanged.
  if (
    client?.onboarding_type === "new" &&
    client.intake_status !== "onboarding_started" &&
    client.intake_status !== "onboarding_submitted"
  ) {
    return (
      <IntakePending
        clientName={profile.full_name ?? client.name ?? "there"}
        intakeStatus={client.intake_status}
      />
    );
  }

  // Canonical project state (CX1) — the single source the Overview consumes.
  const project = canonicalProjectState(stages, {
    estimatedLaunchDate: client?.estimated_launch_date ?? null,
  });

  // Success Manager: assigned → default → fallback (settings-backed).
  const successManager = await resolveSuccessManager(
    client?.success_manager_id ?? null
  );

  // Per-service friendly status + resolved operational enum (drives the header
  // aggregate and the services summary).
  const websiteSignals = {
    liveUrl: client?.website_live_url ?? null,
    previewUrl: client?.website_preview_url ?? null,
    launchCompleted: project.launched,
    hasRoadmapProgress: project.stages.some(
      (s) => s.status === "in_progress" || s.status === "completed"
    ),
  };
  const overviewServices: OverviewServiceInput[] = services.map((s) => {
    const operational = resolveServiceOperational({
      service: s.service,
      operationalStatus: s.operational_status,
      onboardingStatus: s.onboarding_status,
      website: s.service === "website" ? websiteSignals : undefined,
    });
    return {
      service: s.service,
      name: SERVICE_NAME[s.service],
      statusLabel: clientOperationalLabel(s.service, operational),
      operational,
    };
  });

  // Outstanding required assets/access — surfaced as an action only after the
  // admin hasn't yet received them (mirrors the previous readiness behaviour).
  const readiness = computeReadiness(
    services.map((s) => s.service),
    onboarding
  );
  const assetsReceived =
    stages.find((s) => s.name === "Assets Received")?.status === "completed";
  const readinessPending = assetsReceived
    ? 0
    : Math.max(0, readiness.totalItems - readiness.totalDone);

  const overview = buildClientOverview({
    clientName: profile.full_name ?? client?.name ?? "there",
    project,
    website: {
      previewUrl: client?.website_preview_url ?? null,
      liveUrl: client?.website_live_url ?? null,
    },
    services: overviewServices,
    onboardingComplete: isOnboardingComplete(services),
    readinessPending,
    actionItems: actionItems.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      link: a.link,
    })),
  });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Opening Home clears the project seen-state (the journey lives here). */}
      <SeenMarker section="project" />

      {/* 1. Do you need anything? — one authoritative action / reassurance strip */}
      <OverviewAttention attention={overview.attention} />

      {/* 2 & 3. Where are we? / What happens next? — the primary anchor */}
      <ProjectStateHeader clientName={overview.clientName} header={overview.header} />

      {/* 4. What is Bbettr doing? — the single latest curated update */}
      <LatestUpdate update={updates[0] ?? null} />

      {/* 5. How does the whole project fit together? — secondary journey */}
      {overview.showJourney && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Route className="h-4.5 w-4.5 text-brand-500" />
              <CardTitle>Project journey</CardTitle>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/project">
                View full project <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <ProjectJourney stages={stages} />
          </CardContent>
        </Card>
      )}

      {/* 6. Services — for multi-service / services-only clients only */}
      {overview.showServices && <ServicesSummary services={overview.services} />}

      {/* 7. Who's looking after you — quiet, secondary */}
      <SuccessManagerCard manager={successManager} />
    </div>
  );
}

/** Client-facing service display names (kept in step with the services catalog). */
const SERVICE_NAME: Record<OverviewServiceInput["service"], string> = {
  website: "Website Design",
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  seo: "SEO",
};
