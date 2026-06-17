"use client";

import { format } from "date-fns";
import { Mail, Phone, User, FileText } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  OnboardingStatusBadge,
} from "@/components/ui/status-badge";
import { getService } from "@/lib/services";
import { ClientStatusControl } from "@/components/admin/client-status-control";
import { StageManager } from "@/components/admin/stage-manager";
import { ProjectSettingsManager } from "@/components/admin/project-settings-manager";
import { ActivityManager } from "@/components/admin/activity-manager";
import { ContractManager } from "@/components/admin/contract-manager";
import { IntakePanel } from "@/components/admin/intake-panel";
import { BillingPanel } from "@/components/admin/billing-panel";
import type { ContractView } from "@/lib/queries";
import { AssetsReceivedControl } from "@/components/admin/assets-received-control";
import { RequestActionComposer } from "@/components/admin/request-action-composer";
import { computeReadiness } from "@/lib/readiness";
import { UpdateComposer } from "@/components/admin/update-composer";
import { ReportComposer } from "@/components/admin/report-composer";
import { UpdatesTimeline } from "@/components/updates/updates-timeline";
import { ReportCard } from "@/components/reports/report-card";
import { FileManager } from "@/components/files/file-manager";
import { PortalAccessCard } from "@/components/admin/portal-access-card";
import { ClipboardList } from "lucide-react";
import type {
  PortalAccess,
  DealLink,
  LinkableDeal,
  ClientBilling,
} from "@/lib/admin-queries";
import type {
  Client,
  ClientService,
  ProjectStage,
  Update,
  Report,
  FileRecord,
  OnboardingSubmission,
} from "@/lib/database.types";

interface ClientDetailProps {
  client: Client;
  services: ClientService[];
  stages: ProjectStage[];
  updates: Update[];
  reports: Report[];
  files: FileRecord[];
  onboarding: OnboardingSubmission[];
  portalUrl: string;
  portalAccess: PortalAccess;
  teamMembers: { id: string; name: string; role: string | null; is_default: boolean }[];
  activity: {
    id: string;
    type: string;
    title: string;
    description: string | null;
    visibility: string;
    occurred_at: string;
    source: string;
  }[];
  contracts: ContractView[];
  dealLink: DealLink | null;
  linkableDeals: LinkableDeal[];
  billing: ClientBilling;
}

export function ClientDetail({
  client,
  services,
  stages,
  updates,
  reports,
  files,
  onboarding,
  portalUrl,
  portalAccess,
  teamMembers,
  activity,
  contracts,
  dealLink,
  linkableDeals,
  billing,
}: ClientDetailProps) {
  const readiness = computeReadiness(
    services.map((s) => s.service),
    onboarding
  );
  const assetsReceived =
    stages.find((s) => s.name === "Assets Received")?.status === "completed";

  // Highest contract status across the client's contracts, for the Intake panel.
  const contractStatus: "none" | "not_sent" | "sent" | "signed" =
    contracts.some((c) => c.status === "signed")
      ? "signed"
      : contracts.some((c) => c.status === "sent")
        ? "sent"
        : contracts.length > 0
          ? "not_sent"
          : "none";

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "intake", label: "Intake" },
    { id: "onboarding", label: "Onboarding", count: onboarding.length },
    { id: "progress", label: "Progress", count: stages.length },
    { id: "contracts", label: "Contracts", count: contracts.length },
    { id: "updates", label: "Updates", count: updates.length },
    { id: "reports", label: "Reports", count: reports.length },
    { id: "files", label: "Files", count: files.length },
    { id: "billing", label: "Billing", count: billing.invoices.length },
  ];

  return (
    <Tabs items={tabs}>
      {(active) => (
        <>
          {active === "overview" && (
            <div className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Contact</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <InfoRow icon={User} label="Contact" value={client.contact_name} />
                  <InfoRow icon={Mail} label="Email" value={client.contact_email} />
                  <InfoRow icon={Phone} label="Phone" value={client.contact_phone} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Account & Services</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-ink-400">
                      Account Status
                    </p>
                    <ClientStatusControl
                      clientId={client.id}
                      status={client.status}
                    />
                    <p className="mt-1.5 text-xs text-ink-400">
                      Internal lifecycle label — the project&apos;s real progress
                      is the roadmap below in the Progress tab.
                    </p>
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-ink-400">
                      Services
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {services.length > 0 ? (
                        services.map((s) => (
                          <span
                            key={s.id}
                            className="rounded-md bg-ink-100 px-2 py-1 text-xs font-medium text-ink-700"
                          >
                            {getService(s.service).name}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-ink-400">None</span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
              <PortalAccessCard
                clientId={client.id}
                portalUrl={portalUrl}
                access={portalAccess}
              />
            </div>
          )}

          {active === "onboarding" && (
            <div className="space-y-4">
              {onboarding.length > 0 ? (
                onboarding.map((sub) => (
                  <Card key={sub.id}>
                    <CardHeader className="flex-row items-center justify-between">
                      <CardTitle>{getService(sub.service).name}</CardTitle>
                      <OnboardingStatusBadge status={sub.status} />
                    </CardHeader>
                    <CardContent>
                      <SubmissionView data={sub.data} />
                    </CardContent>
                  </Card>
                ))
              ) : (
                <EmptyState
                  icon={ClipboardList}
                  title="No onboarding submitted yet"
                  description="The client hasn't started their onboarding."
                />
              )}
            </div>
          )}

          {active === "progress" && (
            <div className="space-y-6">
              <AssetsReceivedControl
                clientId={client.id}
                readiness={readiness}
                assetsReceived={assetsReceived}
              />
              <Card>
                <CardHeader>
                  <CardTitle>Client Experience</CardTitle>
                </CardHeader>
                <CardContent>
                  <ProjectSettingsManager
                    clientId={client.id}
                    estimatedLaunchDate={client.estimated_launch_date}
                    successManagerId={client.success_manager_id}
                    teamMembers={teamMembers}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Project Roadmap</CardTitle>
                </CardHeader>
                <CardContent>
                  <StageManager clientId={client.id} stages={stages} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Activity Timeline</CardTitle>
                </CardHeader>
                <CardContent>
                  <ActivityManager clientId={client.id} events={activity} />
                </CardContent>
              </Card>
            </div>
          )}

          {active === "intake" && (
            <Card>
              <CardHeader>
                <CardTitle>Intake</CardTitle>
              </CardHeader>
              <CardContent>
                <IntakePanel
                  clientId={client.id}
                  onboardingType={client.onboarding_type}
                  intakeStatus={client.intake_status}
                  contractStatus={contractStatus}
                  hasPortalAccess={portalAccess.hasLogin}
                  welcomeEmailSent={Boolean(client.welcome_email_sent_at)}
                  dealLink={dealLink}
                  linkableDeals={linkableDeals}
                />
              </CardContent>
            </Card>
          )}

          {active === "contracts" && (
            <Card>
              <CardHeader>
                <CardTitle>Contracts</CardTitle>
              </CardHeader>
              <CardContent>
                <ContractManager clientId={client.id} contracts={contracts} />
              </CardContent>
            </Card>
          )}

          {active === "updates" && (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-6">
                <Card className="h-fit">
                  <CardHeader>
                    <CardTitle>Post an update</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <UpdateComposer clientId={client.id} />
                  </CardContent>
                </Card>
                <Card className="h-fit border-amber-200">
                  <CardContent className="p-6">
                    <RequestActionComposer clientId={client.id} />
                  </CardContent>
                </Card>
              </div>
              <div>
                {updates.length > 0 ? (
                  <UpdatesTimeline updates={updates} />
                ) : (
                  <p className="py-8 text-center text-sm text-ink-400">
                    No updates posted yet.
                  </p>
                )}
              </div>
            </div>
          )}

          {active === "reports" && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Create / update a monthly report</CardTitle>
                </CardHeader>
                <CardContent>
                  <ReportComposer clientId={client.id} />
                </CardContent>
              </Card>
              {reports.length > 0 && (
                <div className="grid gap-6 xl:grid-cols-2">
                  {reports.map((r) => (
                    <ReportCard key={r.id} report={r} />
                  ))}
                </div>
              )}
            </div>
          )}

          {active === "files" && (
            <FileManager
              clientId={client.id}
              initialFiles={files}
              isAdmin
            />
          )}

          {active === "billing" && (
            <Card>
              <CardHeader>
                <CardTitle>Billing</CardTitle>
              </CardHeader>
              <CardContent>
                <BillingPanel clientId={client.id} billing={billing} />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </Tabs>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-50 text-ink-400">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="text-xs text-ink-400">{label}</p>
        <p className="text-sm font-medium text-ink-900">{value ?? "—"}</p>
      </div>
    </div>
  );
}

/** Render arbitrary onboarding JSONB as readable key/value pairs. */
function SubmissionView({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  );
  if (entries.length === 0)
    return <p className="text-sm text-ink-400">No answers yet.</p>;

  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">
            {key.replace(/_/g, " ")}
          </dt>
          <dd className="mt-0.5 text-sm text-ink-800">{renderValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function renderValue(value: unknown): React.ReactNode {
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    // Array of uploaded files {name, path}
    if (typeof value[0] === "object" && value[0] !== null && "name" in (value[0] as object)) {
      return (
        <ul className="space-y-0.5">
          {(value as { name: string }[]).map((f, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-ink-400" /> {f.name}
            </li>
          ))}
        </ul>
      );
    }
    return (value as unknown[]).map((v) => String(v)).join(", ");
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}
