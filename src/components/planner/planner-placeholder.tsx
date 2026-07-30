import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Protected placeholder for Planner views whose feature is not built yet (the
 * task-centric views). The route is real and admin-gated; the content honestly
 * says the view is coming rather than faking behaviour.
 */
export function PlannerPlaceholder({
  title,
  description,
  icon: Icon,
  note,
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  note: string;
}) {
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
          <Icon className="h-8 w-8 text-ink-300" />
          <p className="max-w-md text-sm text-ink-500">{note}</p>
        </CardContent>
      </Card>
    </div>
  );
}
