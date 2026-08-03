import { Badge } from "@/components/ui/badge";
import type { TaskPriority } from "@/lib/database.types";
import { TASK_PRIORITY_BADGE } from "./task-badge-config";

export { TASK_PRIORITY_BADGE };

/** Priority badge — readable text label + an existing Portal tone (never colour-only). */
export function TaskPriorityBadge({ priority, className }: { priority: TaskPriority; className?: string }) {
  const { tone, label } = TASK_PRIORITY_BADGE[priority];
  return (
    <Badge tone={tone} dot className={className}>
      {label}
    </Badge>
  );
}
