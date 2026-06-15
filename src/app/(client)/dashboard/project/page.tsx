import type { Metadata } from "next";
import { SeenMarker } from "@/components/shared/seen-marker";
import { Route, CheckCircle2, Clock, Circle } from "lucide-react";
import { requireClient } from "@/lib/auth";
import { getProjectStages, computeProgress } from "@/lib/queries";
import { toClientJourney } from "@/lib/journey";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-tracker";
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
          <Card>
            <CardContent className="p-6">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-ink-600">
                  Overall completion
                </span>
                <span className="text-sm font-bold text-ink-900">
                  {progress}%
                </span>
              </div>
              <ProgressBar value={progress} />
            </CardContent>
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

            <div className="space-y-4">
              <WorkColumn
                icon={CheckCircle2}
                tone="text-emerald-500"
                title="Completed Work"
                labels={buckets.completed}
              />
              <WorkColumn
                icon={Clock}
                tone="text-amber-500"
                title="In Progress"
                labels={buckets.in_progress}
              />
              <WorkColumn
                icon={Circle}
                tone="text-ink-300"
                title="Upcoming Work"
                labels={buckets.pending}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function WorkColumn({
  icon: Icon,
  tone,
  title,
  labels,
}: {
  icon: typeof CheckCircle2;
  tone: string;
  title: string;
  labels: string[];
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Icon className={`h-4 w-4 ${tone}`} />
          <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
          <span className="ml-auto text-xs font-medium text-ink-400">
            {labels.length}
          </span>
        </div>
        {labels.length > 0 ? (
          <ul className="space-y-2">
            {labels.map((label, i) => (
              <li key={`${label}-${i}`} className="text-sm text-ink-600">
                {label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-400">Nothing here yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
