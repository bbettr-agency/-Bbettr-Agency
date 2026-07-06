import type { Metadata } from "next";
import Link from "next/link";
import { format } from "date-fns";
import { ArrowRight, Megaphone, Route, Sparkles } from "lucide-react";
import { requireClient } from "@/lib/auth";
import {
  getClient,
  getClientServices,
  getProjectStages,
  getUpdates,
  getOnboarding,
  getOpenActionItems,
  getActivityTimeline,
  computeProgress,
  isOnboardingComplete,
} from "@/lib/queries";
import { ActionRequiredBanner } from "@/components/client/action-required-banner";
import { WelcomeHero } from "@/components/client/welcome-hero";
import { ProjectJourney } from "@/components/client/project-journey";
import { NextStepCard } from "@/components/client/next-step-card";
import { SuccessManagerCard } from "@/components/client/success-manager-card";
import { PackageOverview } from "@/components/client/package-overview";
import { ActivityTimeline } from "@/components/client/activity-timeline";
import { IntakePending } from "@/components/client/intake-pending";
import { currentJourneyLabel, toClientJourney } from "@/lib/journey";
import { resolveSuccessManager } from "@/lib/success-manager";
import { computeReadiness } from "@/lib/readiness";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ReadinessChecklist } from "@/components/shared/readiness-checklist";
import { PackageCheck, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const profile = await requireClient();
  const [client, services, stages, updates, onboarding, actionItems, activity] =
    await Promise.all([
      getClient(profile.client_id),
      getClientServices(profile.client_id),
      getProjectStages(profile.client_id),
      getUpdates(profile.client_id, 3),
      getOnboarding(profile.client_id),
      getOpenActionItems(profile.client_id),
      getActivityTimeline(profile.client_id),
    ]);

  // New intake clients see a calm holding panel until their onboarding opens.
  // Legacy + existing clients (intake_status onboarding_started/submitted) get
  // the full dashboard. Defensive content gate — onboarding access is unchanged.
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

  const progress = computeProgress(stages);
  const journey = toClientJourney(stages);
  const currentStage = currentJourneyLabel(journey);
  const onboardingComplete = isOnboardingComplete(services);

  // Success Manager: assigned → default → fallback (settings-backed).
  const successManager = await resolveSuccessManager(
    client?.success_manager_id ?? null
  );

  // Next Step: derive from the journey + the active stage's ETA (else launch date).
  const activeStep = journey.find((j) => j.status === "in_progress") ?? null;
  const allComplete =
    journey.length > 0 && journey.every((j) => j.status === "completed");
  const nextStepState = allComplete
    ? "complete"
    : activeStep
      ? "in_progress"
      : journey.some((j) => j.status === "pending")
        ? "pending"
        : "none";
  const nextStepDate =
    activeStep?.targetDate ?? client?.estimated_launch_date ?? null;

  // Asset readiness: show the client what we still need, until an admin has
  // confirmed the "Assets Received" stage.
  const readiness = computeReadiness(
    services.map((s) => s.service),
    onboarding
  );
  const assetsReceived =
    stages.find((s) => s.name === "Assets Received")?.status === "completed";
  const showChecklist = readiness.hasItems && !assetsReceived;

  // Once the project has launched, drop the "Onboarding Complete" card — the
  // roadmap / current-phase card tells the story from then on.
  const launchComplete =
    stages.find((s) => s.name === "Launch")?.status === "completed";

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Action required — highest priority, top of the dashboard */}
      <ActionRequiredBanner items={actionItems} />

      {/* Welcome hero */}
      <WelcomeHero
        clientName={profile.full_name ?? client?.name ?? "Welcome"}
        completion={progress}
        currentStage={currentStage}
        estimatedLaunchDate={client?.estimated_launch_date ?? null}
      />

      {/* Asset readiness checklist — what we still need from the client */}
      {showChecklist && (
        <Card className={readiness.allReady ? "border-emerald-200" : "border-brand-200"}>
          <CardHeader className="flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <PackageCheck className="h-4.5 w-4.5 text-brand-500" />
              <CardTitle>
                {readiness.allReady ? "Everything received" : "What we still need from you"}
              </CardTitle>
            </div>
            <Badge tone={readiness.allReady ? "success" : "warning"} dot>
              {readiness.totalDone}/{readiness.totalItems} received
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {readiness.allReady ? (
              <p className="flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Thank you — we have everything we need and your team is reviewing
                it now.
              </p>
            ) : (
              <p className="text-sm text-ink-500">
                Please provide the items marked <strong>Pending</strong> so we
                can begin. You can add them from your onboarding forms and files.
              </p>
            )}
            <ReadinessChecklist readiness={readiness} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Progress tracker */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Route className="h-4.5 w-4.5 text-brand-500" />
              <CardTitle>Project Journey</CardTitle>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/project">
                View project <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {stages.length > 0 ? (
              <ProjectJourney stages={stages} />
            ) : (
              <EmptyState
                icon={Route}
                title="No project stages yet"
                description="Your Bbettr Agency team will set up your project roadmap shortly."
              />
            )}
          </CardContent>
        </Card>

        {/* Right rail: what's next + who's looking after you */}
        <div className="space-y-6">
          <NextStepCard
            stageLabel={currentStage}
            state={nextStepState}
            estimatedCompletion={nextStepDate}
            actionItems={actionItems}
          />
          <SuccessManagerCard manager={successManager} />
        </div>
      </div>

      {/* Package deliverables + growth opportunities */}
      <PackageOverview purchased={services.map((s) => s.service)} />

      {/* Activity timeline */}
      <ActivityTimeline events={activity} />

      {/* Latest updates */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Megaphone className="h-4.5 w-4.5 text-brand-500" />
            <CardTitle>Latest Updates</CardTitle>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard/updates">
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {updates.length > 0 ? (
            updates.map((u) => (
              <Link
                key={u.id}
                href="/dashboard/updates"
                className="block rounded-xl border border-ink-100 p-3.5 transition-colors hover:border-brand-200 hover:bg-brand-50/40"
              >
                <p className="text-xs text-ink-400">
                  {format(new Date(u.published_at), "d MMM yyyy")}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-ink-900">
                  {u.title}
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-ink-500">{u.body}</p>
              </Link>
            ))
          ) : (
            <div className="flex flex-col items-center gap-2 py-8 text-center sm:col-span-2 lg:col-span-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-500">
                <Megaphone className="h-5 w-5" />
              </span>
              <p className="text-sm font-semibold text-ink-900">
                Your project feed starts soon
              </p>
              <p className="max-w-sm text-xs text-ink-400">
                We post here as work happens — you&apos;ll see a dot in the
                sidebar whenever something new lands.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Onboarding nudge (incomplete) → completion message (complete, pre-launch) */}
      {!onboardingComplete ? (
        <Card className="border-brand-200 bg-brand-50/40">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-white">
                <Sparkles className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-900">
                  Complete your onboarding
                </p>
                <p className="text-sm text-ink-500">
                  Help us get started by filling in the details for your services.
                </p>
              </div>
            </div>
            <Button asChild>
              <Link href="/dashboard/onboarding">
                Continue onboarding <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : !launchComplete ? (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardContent className="flex items-start gap-3 p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink-900">
                Onboarding Complete
              </p>
              <p className="text-sm text-ink-500">
                Our team is now preparing your project.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
