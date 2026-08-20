"use client";

import { format } from "date-fns";
import Link from "next/link";
import { Mail, Phone, User, FileText } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { ClientStatusBadge } from "@/components/ui/status-badge";
import {
  WorkspaceRail,
  WorkspacePills,
  useWorkspaceSection,
  type SectionCounts,
} from "@/components/admin/client-workspace-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  OnboardingStatusBadge,
} from "@/components/ui/status-badge";
import { getService } from "@/lib/services";
import { ClientStatusControl } from "@/components/admin/client-status-control";
import { ClientServicesManager } from "@/components/admin/client-services-manager";
import { StageManager } from "@/components/admin/stage-manager";
import { ProjectSettingsManager } from "@/components/admin/project-settings-manager";
import { ActivityManager } from "@/components/admin/activity-manager";
import { ContractManager } from "@/components/admin/contract-manager";
import { IntakePanel } from "@/components/admin/intake-panel";
import { BillingPanel } from "@/components/admin/billing-panel";
import { BillingDetailsCard } from "@/components/admin/billing-details-card";
import type { BillingDetailsView } from "@/lib/billing-details";
import type { ContractView } from "@/lib/queries";
import type { ReactionSummary } from "@/lib/update-reactions";
import { AssetsReceivedControl } from "@/components/admin/assets-received-control";
import { RequestActionComposer } from "@/components/admin/request-action-composer";
import { computeReadiness } from "@/lib/readiness";
import { UpdateComposer } from "@/components/admin/update-composer";
import { ReportComposer } from "@/components/admin/report-composer";
import { UpdatesTimeline } from "@/components/updates/updates-timeline";
import { UpdateQuestionsPanel } from "@/components/admin/update-questions-panel";
import { ReportCard } from "@/components/reports/report-card";
import { FileManager } from "@/components/files/file-manager";
import { PortalAccessCard } from "@/components/admin/portal-access-card";
import { ClipboardList } from "lucide-react";
import type {
  PortalAccess,
  DealLink,
  LinkableDeal,
  ClientBilling,
  UpdateQuestionView,
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
  billingDetails: BillingDetailsView | null;
  updateReactions: Record<string, ReactionSummary>;
  updateQuestions: UpdateQuestionView[];
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
  billingDetails,
  updateReactions,
  updateQuestions,
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

  // Active section lives in ?section= (shallow pushState — instant switching,
  // deep-linkable, reload-safe, back/forward walks section history).
  const [active, navigate] = useWorkspaceSection();

  // Services that have a real onboarding submission → drives "View Onboarding".
  const onboardingServices = onboarding.map((s) => s.service);

  // Aggregate the legacy per-section counts into the 4 primary destinations.
  const counts: SectionCounts = {
    work: stages.length + updates.length,
    money: billing.invoices.length,
    documents: contracts.length + files.length + reports.length,
  };

  return (
    <div>
      {/* Sticky client header — breadcrumb-shaped, always visible while
          scrolling. Below xl the section pills stick to it as one unit. */}
      <div className="sticky top-16 z-10 -mx-4 border-b border-ink-100 bg-white/90 px-4 backdrop-blur-lg sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 py-2">
          <Link
            href="/admin/clients"
            className="text-sm font-medium text-ink-400 transition-colors hover:text-ink-800"
          >
            Clients
          </Link>
          <span className="text-ink-300">/</span>
          <span className="flex min-w-0 items-center gap-2.5">
            <Avatar name={client.name} size="sm" />
            <span className="truncate font-display text-base font-bold text-ink-900">
              {client.name}
            </span>
          </span>
          <ClientStatusBadge status={client.status} />
          <span className="hidden flex-wrap items-center gap-1 md:flex">
            {services.map((s) => (
              <span
                key={s.id}
                className="rounded-md bg-ink-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-600"
              >
                {getService(s.service).name}
              </span>
            ))}
          </span>
          <span className="ml-auto hidden items-center gap-1.5 text-xs font-medium sm:flex">
            <span
              className={
                portalAccess.hasLogin
                  ? "h-2 w-2 rounded-full bg-emerald-500"
                  : "h-2 w-2 rounded-full bg-ink-300"
              }
              aria-hidden
            />
            <span className={portalAccess.hasLogin ? "text-emerald-700" : "text-ink-400"}>
              {portalAccess.hasLogin ? "Portal active" : "No portal access"}
            </span>
          </span>
        </div>
        {/* Section pills — below xl only */}
        <div className="xl:hidden">
          <WorkspacePills active={active} counts={counts} onNavigate={navigate} />
        </div>
      </div>

      {/* Workspace: grouped rail (xl+) + section content */}
      <div className="pt-6 xl:grid xl:grid-cols-[13rem_minmax(0,1fr)] xl:gap-8">
        <aside className="hidden xl:block">
          <div className="sticky top-36">
            <WorkspaceRail active={active} counts={counts} onNavigate={navigate} />
          </div>
        </aside>
        <div className="min-w-0 space-y-6">
          {active === "command-centre" && (
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
                    <ClientServicesManager
                      clientId={client.id}
                      clientName={client.name}
                      services={services}
                      onboardingServices={onboardingServices}
                      onViewOnboarding={() => navigate("work")}
                    />
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

          {active === "work" && (
            <details className="rounded-xl border border-ink-100 bg-white p-4">
              <summary className="cursor-pointer text-sm font-semibold text-ink-700">Onboarding answers</summary>
              <div className="space-y-4 pt-4">
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
            </details>
          )}

          {active === "work" && (
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

          {active === "work" && (
            <details className="rounded-xl border border-ink-100 bg-white p-4">
              <summary className="cursor-pointer text-sm font-semibold text-ink-700">Intake pipeline</summary>
              <div className="pt-4">
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
              </div>
            </details>
          )}

          {active === "documents" && (
            <Card>
              <CardHeader>
                <CardTitle>Contracts</CardTitle>
              </CardHeader>
              <CardContent>
                <ContractManager clientId={client.id} contracts={contracts} />
              </CardContent>
            </Card>
          )}

          {active === "work" && (
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
              <div className="space-y-6">
                <UpdateQuestionsPanel questions={updateQuestions} />
                {updates.length > 0 ? (
                  <UpdatesTimeline updates={updates} reactions={updateReactions} />
                ) : (
                  <p className="py-8 text-center text-sm text-ink-400">
                    No updates posted yet.
                  </p>
                )}
              </div>
            </div>
          )}

          {active === "documents" && (
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

          {active === "documents" && (
            <FileManager
              clientId={client.id}
              initialFiles={files}
              isAdmin
            />
          )}

          {active === "money" && (
            <div className="space-y-6">
              <BillingDetailsCard
                clientId={client.id}
                initial={billingDetails}
                contactEmail={client.contact_email}
              />
              <Card>
                <CardHeader>
                  <CardTitle>Billing</CardTitle>
                </CardHeader>
                <CardContent>
                  <BillingPanel clientId={client.id} billing={billing} />
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
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
