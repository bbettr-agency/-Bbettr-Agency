import { Badge } from "@/components/ui/badge";
import type {
  ClientStatus,
  OnboardingStatus,
  StageStatus,
} from "@/lib/database.types";

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
