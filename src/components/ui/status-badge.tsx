import { Badge } from "@/components/ui/badge";
import type {
  ClientStatus,
  OnboardingStatus,
  StageStatus,
  DealStatus,
  InvoiceRequestStatus,
  ClientLocation,
} from "@/lib/database.types";

const invoiceStatusMap: Record<
  "draft" | "sent" | "paid" | "void" | "overdue",
  { label: string; tone: "neutral" | "info" | "success" | "danger" }
> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  overdue: { label: "Overdue", tone: "danger" },
  paid: { label: "Paid", tone: "success" },
  void: { label: "Void", tone: "neutral" },
};

/** Badge for a client invoice's derived status (overdue is computed, not stored). */
export function InvoiceStatusBadge({
  status,
}: {
  status: "draft" | "sent" | "paid" | "void" | "overdue";
}) {
  const cfg = invoiceStatusMap[status];
  return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
}

const clientLocationMap: Record<
  ClientLocation,
  { label: string; tone: "brand" | "info" }
> = {
  south_africa: { label: "South Africa", tone: "brand" },
  international: { label: "International", tone: "info" },
};

/** Human label for a client location (e.g. for plain-text / email use). */
export function clientLocationLabel(location: ClientLocation): string {
  return clientLocationMap[location].label;
}

export function ClientLocationBadge({ location }: { location: ClientLocation }) {
  const cfg = clientLocationMap[location];
  return (
    <Badge tone={cfg.tone} dot>
      {cfg.label}
    </Badge>
  );
}

const dealStatusMap: Record<
  DealStatus,
  { label: string; tone: "brand" | "neutral" | "success" | "warning" | "info" }
> = {
  new: { label: "New", tone: "neutral" },
  invoice_requested: { label: "Invoice Requested", tone: "warning" },
  invoiced: { label: "Invoiced", tone: "info" },
  won: { label: "Won", tone: "success" },
  lost: { label: "Lost", tone: "neutral" },
};

export function DealStatusBadge({ status }: { status: DealStatus }) {
  const cfg = dealStatusMap[status];
  return <Badge tone={cfg.tone} dot>{cfg.label}</Badge>;
}

const invoiceRequestStatusMap: Record<
  InvoiceRequestStatus,
  { label: string; tone: "neutral" | "warning" | "success" | "danger" | "info" }
> = {
  pending: { label: "Pending", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  invoiced: { label: "Invoiced", tone: "info" },
  failed: { label: "Failed", tone: "danger" },
};

export function InvoiceRequestStatusBadge({
  status,
}: {
  status: InvoiceRequestStatus;
}) {
  const cfg = invoiceRequestStatusMap[status];
  return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
}

const clientStatusMap: Record<
  ClientStatus,
  { label: string; tone: "brand" | "neutral" | "success" | "warning" | "info" }
> = {
  lead: { label: "Lead", tone: "neutral" },
  onboarding: { label: "Onboarding", tone: "warning" },
  in_progress: { label: "In Progress", tone: "info" },
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "neutral" },
  completed: { label: "Completed", tone: "brand" },
};

export function ClientStatusBadge({ status }: { status: ClientStatus }) {
  const cfg = clientStatusMap[status];
  return (
    <Badge tone={cfg.tone} dot>
      {cfg.label}
    </Badge>
  );
}

const onboardingStatusMap: Record<
  OnboardingStatus,
  { label: string; tone: "neutral" | "warning" | "info" | "success" }
> = {
  not_started: { label: "Not Started", tone: "neutral" },
  in_progress: { label: "In Progress", tone: "warning" },
  submitted: { label: "Submitted", tone: "info" },
  approved: { label: "Approved", tone: "success" },
};

export function OnboardingStatusBadge({ status }: { status: OnboardingStatus }) {
  const cfg = onboardingStatusMap[status];
  return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
}

const stageStatusMap: Record<
  StageStatus,
  { label: string; tone: "success" | "warning" | "neutral" }
> = {
  completed: { label: "Completed", tone: "success" },
  in_progress: { label: "In Progress", tone: "warning" },
  pending: { label: "Pending", tone: "neutral" },
};

export function StageStatusBadge({ status }: { status: StageStatus }) {
  const cfg = stageStatusMap[status];
  return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
}
