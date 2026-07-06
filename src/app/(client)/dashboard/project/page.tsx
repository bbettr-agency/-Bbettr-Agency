import type { Metadata } from "next";
import { SeenMarker } from "@/components/shared/seen-marker";
import { Route, CheckCircle2, Clock, Circle } from "lucide-react";
import { requireClient } from "@/lib/auth";
import { getProjectStages, computeProgress } from "@/lib/queries";
import { toClientJourney } from "@/lib/journey";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectJourney } from "@/components/client/project-journey";

export const metadata: Metadata = { title: "Project Progress" };

export default async function ProjectPage() {
  const profile = await requireClient();
  const stages = await getProjectStages(profile.client_id);
  const progress = computeProgress(stages);

  // Client-facing journey labels only — never the internal operational names.
  const journey = toClientJourney(stages);
  const buckets = {
    completed: journey.filter((s) => s.status === "completed").map((s) => s.label),
    in_progress: journey.filter((s) => s.status === "in_progress").map((s) => s.label),
    pending: journey.filter((s) => s.status === "pending").map((s) => s.label),
  };
  const completedCount = buckets.completed.length;
  const totalCount = journey.length;

  return (
    <div className="space-y-6 animate-fade-in">
      <SeenMarker section="project" />
      <PageHeader
        title="Project Progress"
        description="Track exactly where your project stands at every stage."
      />

      {stages.length === 0 ? (
        <EmptyState
          icon={Route}
          title="No project roadmap yet"
          description="Your Bbettr Agency team will publish your project stages soon."
        />
      ) : (
        <>
          {/* Overall completion — the number clients care about most, given a
              proper moment (same premium dark treatment as the dashboard hero). */}
          <Card className="relative overflow-hidden border-0 bg-ink-900 text-white shadow-card-hover">
            <div
              className="relative p-6 sm:p-8"
              style={{
                backgroundImage:
                  "radial-gradient(70% 120% at 90% 0%, rgba(56,182,255,0.35), transparent 55%)",
              }}
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-300">
                Overall completion
              </p>
              <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
                <span className="font-display text-4xl font-bold">
                  {progress}%
                </span>
                <span className="text-sm text-white/60">
                  {completedCount} of {totalCount} stage
                  {totalCount === 1 ? "" : "s"} complete
                </span>
              </div>
              <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-300 to-brand-500 transition-all duration-700 ease-out"
                  style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                />
              </div>
              <p className="mt-4 text-xs text-white/50">
                Your Bbettr team updates this roadmap as work happens — no need
                to ask for status.
              </p>
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Roadmap</CardTitle>
              </CardHeader>
              <CardContent>
                <ProjectJourney stages={stages} />
              </CardContent>
            </Card>

            {/* One cohesive "work at a glance" card — three segments that hold
                together even when a segment is still empty early on. */}
            <Card className="h-fit">
              <CardHeader>
                <CardTitle>Work at a glance</CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-ink-100 p-0">
                <WorkSegment
                  icon={CheckCircle2}
                  tone="text-emerald-500"
                  title="Completed"
                  labels={buckets.completed}
                  emptyNote="Finished work will collect here."
                />
                <WorkSegment
                  icon={Clock}
                  tone="text-amber-500"
                  title="In Progress"
                  labels={buckets.in_progress}
                  emptyNote="Nothing mid-flight right now."
                />
                <WorkSegment
                  icon={Circle}
                  tone="text-ink-300"
                  title="Up Next"
                  labels={buckets.pending}
                  emptyNote="No upcoming stages — you're near the finish line."
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function WorkSegment({
  icon: Icon,
  tone,
  title,
  labels,
  emptyNote,
}: {
  icon: typeof CheckCircle2;
  tone: string;
  title: string;
  labels: string[];
  emptyNote: string;
}) {
  return (
    <div className="px-5 py-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone}`} />
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        <span className="ml-auto rounded-full bg-ink-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-ink-500">
          {labels.length}
        </span>
      </div>
      {labels.length > 0 ? (
        <ul className="space-y-1.5">
          {labels.map((label, i) => (
            <li key={`${label}-${i}`} className="text-sm text-ink-600">
              {label}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-400">{emptyNote}</p>
      )}
    </div>
  );
}
