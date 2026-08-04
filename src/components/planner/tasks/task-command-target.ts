import type { TaskStatus } from "@/lib/database.types";

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
};
