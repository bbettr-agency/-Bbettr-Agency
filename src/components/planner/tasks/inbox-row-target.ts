/**
 * The minimal, serializable command target one Inbox row hands to its Client
 * triage controls. Kept in its own pure, dependency-free module so the Client
 * Component (`inbox-triage-controls.tsx`) can import the type without pulling in
 * any server-only code, and so the Server Components deriving it share one shape.
 *
 * It carries ONLY what a triage/schedule command needs: the task id, the version
 * the row was rendered at (for optimistic concurrency), and the title (for
 * accessible control labels). The full Task record is NEVER handed to the client.
 */
export type InboxRowTarget = {
  taskId: string;
  aggregateVersion: number;
  title: string;
};
