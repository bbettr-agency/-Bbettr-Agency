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
  computeProgress,
} from "@/lib/queries";
import { getService } from "@/lib/services";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClientStatusBadge } from "@/components/ui/status-badge";
import { ProgressTracker, ProgressBar } from "@/components/ui/progress-tracker";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const profile = await requireClient();
  const [client, services, stages, updates] = await Promise.all([
    getClient(profile.client_id),
    getClientServices(profile.client_id),
    getProjectStages(profile.client_id),
    getUpdates(profile.client_id, 3),
  ]);

  const progress = computeProgress(stages);
  const firstName = (profile.full_name ?? "there").split(" ").slice(-1)[0];

  return (
    <div className="space-y-6 animate-fade-in">
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
                Status
              </p>
              <div className="mt-2">
                {client && <ClientStatusBadge status={client.status} />}
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

      {/* Service onboarding nudges */}
      {services.some((s) => s.onboarding_status !== "approved") && (
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
      )}
    </div>
  );
}
