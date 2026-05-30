import type { Metadata } from "next";
import { Route, CheckCircle2, Clock, Circle } from "lucide-react";
import { requireClient } from "@/lib/auth";
import { getProjectStages, computeProgress } from "@/lib/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressTracker, ProgressBar } from "@/components/ui/progress-tracker";
import type { ProjectStage } from "@/lib/database.types";

export const metadata: Metadata = { title: "Project Progress" };

export default async function ProjectPage() {
  const profile = await requireClient();
  const stages = await getProjectStages(profile.client_id);
  const progress = computeProgress(stages);

  const buckets = {
    completed: stages.filter((s) => s.status === "completed"),
    in_progress: stages.filter((s) => s.status === "in_progress"),
    pending: stages.filter((s) => s.status === "pending"),
  };

  return (
    <div className="space-y-6 animate-fade-in">
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
                <ProgressTracker stages={stages} />
              </CardContent>
            </Card>

            <div className="space-y-4">
              <WorkColumn
                icon={CheckCircle2}
                tone="text-emerald-500"
                title="Completed Work"
                stages={buckets.completed}
              />
              <WorkColumn
                icon={Clock}
                tone="text-amber-500"
                title="In Progress"
                stages={buckets.in_progress}
              />
              <WorkColumn
                icon={Circle}
                tone="text-ink-300"
                title="Upcoming Work"
                stages={buckets.pending}
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
  stages,
}: {
  icon: typeof CheckCircle2;
  tone: string;
  title: string;
  stages: ProjectStage[];
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Icon className={`h-4 w-4 ${tone}`} />
          <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
          <span className="ml-auto text-xs font-medium text-ink-400">
            {stages.length}
          </span>
        </div>
        {stages.length > 0 ? (
          <ul className="space-y-2">
            {stages.map((s) => (
              <li key={s.id} className="text-sm text-ink-600">
                {s.name}
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
