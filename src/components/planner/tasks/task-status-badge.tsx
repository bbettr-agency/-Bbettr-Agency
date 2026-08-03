import { Badge } from "@/components/ui/badge";
import type { TaskStatus } from "@/lib/database.types";
import { TASK_STATUS_BADGE } from "./task-badge-config";

export { TASK_STATUS_BADGE };

/** Status badge — readable text label + an existing Portal tone (never colour-only). */
export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const { tone, label } = TASK_STATUS_BADGE[status];
  return (
    <Badge tone={tone} dot className={className}>
      {label}
    </Badge>
  );
}
