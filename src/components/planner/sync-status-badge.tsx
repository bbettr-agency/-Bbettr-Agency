import { Badge } from "@/components/ui/badge";
import type { SafeProjectionView } from "@/lib/planner/meetings/view-types";

/**
 * Renders projection sync state from the SafeProjectionView only. Purely
 * presentational — no inference, no polling, no Google calls.
 */
export function SyncStatusBadge({ view }: { view?: SafeProjectionView }) {
  const state = view?.syncState;
  if (!state) return <Badge tone="neutral" dot>Not synced</Badge>;
  switch (state) {
    case "synced":
      return <Badge tone="success" dot>Synced</Badge>;
    case "pending":
      return <Badge tone="neutral" dot>Sync pending</Badge>;
    case "failed":
      return <Badge tone="warning" dot>Sync failed</Badge>;
    case "disconnected":
      return <Badge tone="warning" dot>Google disconnected</Badge>;
    case "not_applicable":
      return null;
  }
}

/** Meet provisioning state (the ready state is shown as a link, not here). */
export function MeetStatusBadge({ view }: { view?: SafeProjectionView }) {
  const state = view?.meetState;
  if (!state || state === "not_requested" || state === "ready") return null;
  if (state === "pending") return <Badge tone="neutral">Meet provisioning…</Badge>;
  return <Badge tone="warning">Meet unavailable</Badge>;
}
