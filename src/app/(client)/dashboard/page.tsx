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
  computeProgress,
  currentPhase,
  isOnboardingComplete,
} from "@/lib/queries";
import { ActionRequiredBanner } from "@/components/client/action-required-banner";
import { computeReadiness } from "@/lib/readiness";
import { getService } from "@/lib/services";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressTracker, ProgressBar } from "@/components/ui/progress-tracker";
import { EmptyState } from "@/components/ui/empty-state";
import { ReadinessChecklist } from "@/components/shared/readiness-checklist";
import { PackageCheck, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const profile = await requireClient();
  const [client, services, stages, updates, onboarding, actionItems] =
    await Promise.all([
      getClient(profile.client_id),
      getClientServices(profile.client_id),
      getProjectStages(profile.client_id),
      getUpdates(profile.client_id, 3),
      getOnboarding(profile.client_id),
      getOpenActionItems(profile.client_id),
    ]);

  const progress = computeProgress(stages);
  const phase = currentPhase(stages);
  const onboardingComplete = isOnboardingComplete(services);

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
      <Card className="relative overflow-hidden border-0 bg-ink-900 text-white shadow-card-hover">
        <div
          className="relative p-7 sm:p-9"
          style={{
            backgroundImage:
              "radial-gradient(70% 120% at 90% 0%, rgba(56,182,255,0.35), transparent 55%)",
          }}
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-brand-300">
                <Sparkles className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">
                  Welcome back
                </span>
              </div>
              <h1 className="mt-2 font-display text-2xl font-bold sm:text-3xl">
                {profile.full_name ?? client?.name ?? "Welcome"}
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-sm text-white/60">Current services:</span>
                {services.length > 0 ? (
                  services.map((s) => {
                    const def = getService(s.service);
                    return (
                      <span
                        key={s.id}
                        className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white"
                      >
                        <def.icon className="h-3.5 w-3.5" />
                        {def.name}
                      </span>
                    );
                  })
                ) : (
                  <span className="text-sm text-white/50">None yet</span>
                )}
              </div>
            </div>

            <div className="shrink-0 rounded-2xl bg-white/10 p-5 backdrop-blur-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-white/60">
                Current phase
              </p>
              <div className="mt-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm font-semibold text-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-300" />
                  {phase ? phase.label : "Getting started"}
                </span>
              </div>
              <div className="mt-4 w-48">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-white/60">Project progress</span>
                  <span className="font-semibold">{progress}%</span>
                </div>
                <ProgressBar value={progress} className="bg-white/15" />
              </div>
            </div>
          </div>
        </div>
      </Card>

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
              <CardTitle>Progress Tracker</CardTitle>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/project">
                View project <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {stages.length > 0 ? (
              <ProgressTracker stages={stages} />
            ) : (
              <EmptyState
                icon={Route}
                title="No project stages yet"
                description="Your Bbettr Agency team will set up your project roadmap shortly."
              />
            )}
          </CardContent>
        </Card>

        {/* Recent updates */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Megaphone className="h-4.5 w-4.5 text-brand-500" />
              <CardTitle>Latest Updates</CardTitle>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/updates">
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
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
              <p className="py-8 text-center text-sm text-ink-400">
                No updates yet. Check back soon.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

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
