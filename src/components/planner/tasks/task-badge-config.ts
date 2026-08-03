/**
 * Pure status/priority → { tone, label } maps for the Tasks badges.
 *
 * Kept JSX-free (separate from the .tsx components) so the mapping is unit-
 * testable in the node test environment. Uses only existing Portal Badge tones;
 * every entry carries a readable text label so meaning is never colour-only.
 */
import type { TaskPriority, TaskStatus } from "@/lib/database.types";

export type BadgeTone = "brand" | "neutral" | "success" | "warning" | "danger" | "info";

export const TASK_STATUS_BADGE: Record<TaskStatus, { tone: BadgeTone; label: string }> = {
  inbox: { tone: "neutral", label: "Inbox" },
  planned: { tone: "info", label: "Planned" },
  scheduled: { tone: "brand", label: "Scheduled" },
  in_progress: { tone: "warning", label: "In Progress" },
  waiting: { tone: "danger", label: "Waiting" },
  completed: { tone: "success", label: "Completed" },
  archived: { tone: "neutral", label: "Archived" },
};

export const TASK_PRIORITY_BADGE: Record<TaskPriority, { tone: BadgeTone; label: string }> = {
  critical: { tone: "danger", label: "Critical" },
  high: { tone: "warning", label: "High" },
  normal: { tone: "neutral", label: "Normal" },
  low: { tone: "info", label: "Low" },
};
