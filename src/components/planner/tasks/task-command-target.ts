import type { TaskPriority, TaskStatus } from "@/lib/database.types";

/**
 * The minimal, serializable command target a task row hands to its client command
 * controls — the shared-kit equivalent of the Inbox's `InboxRowTarget`. It carries
 * ONLY what a lifecycle command needs: the task id, the version the row was
 * rendered at (optimistic concurrency), the current status (drives which
 * server-computed legal actions render), and the title (accessible labels). The
 * full Task record is never handed to a client.
 */
export type TaskCommandTarget = {
  taskId: string;
  aggregateVersion: number;
  status: TaskStatus;
  title: string;
  /** Current editable fields (for the Edit modal to prefill + diff). Never the raw row. */
  description?: string | null;
  priority?: TaskPriority;
  criticalReason?: string | null;
};

/**
 * The workspace admins a task may be assigned to, plus the acting admin's id (so
 * the picker can label one option "Me"). Names are safe display strings; ids are
 * re-validated server-side on every assignment — the browser id is never trusted.
 * Passed from the server page (via listAdminTeam) into the row controls.
 */
export type AssignChoices = {
  admins: { id: string; name: string }[];
  currentAdminId: string;
};
