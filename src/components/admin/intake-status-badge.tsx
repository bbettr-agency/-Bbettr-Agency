import { Badge } from "@/components/ui/badge";

/** Prospect-intake status → admin badge. Shared by the Intakes list + detail. */
export function IntakeStatusBadge({ status }: { status: string }) {
  if (status === "submitted") return <Badge tone="brand">New</Badge>;
  if (status === "dismissed") return <Badge tone="neutral">Dismissed</Badge>;
  if (status === "converted") return <Badge tone="success">Converted</Badge>;
  if (status === "draft") return <Badge tone="warning">Draft</Badge>;
  return <Badge tone="neutral">{status}</Badge>;
}
