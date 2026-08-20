"use client";

import { format } from "date-fns";
import Link from "next/link";
import { Mail, Phone, User, FileText, ChevronRight, AlertTriangle, CalendarClock, UserRound, ExternalLink } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
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
import { ClientDocumentsSection } from "@/components/admin/client-documents-section";
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
import { UpdatesTimeline } from "@/components/updates/updates-timeline";
import { UpdateQuestionsPanel } from "@/components/admin/update-questions-panel";
import { PortalAccessSummary } from "@/components/admin/portal-access-summary";
import { DangerZone } from "@/components/admin/danger-zone";
import { deriveFocus, deriveAttention } from "@/components/admin/command-centre-state";
import { WebsiteUrlsManager } from "@/components/admin/website-urls-manager";
import { deriveWebsiteState } from "@/lib/website-state";
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
  activityHasMore: boolean;
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
  activityHasMore,
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

  // ── Command Centre derived state (Slice 2A) — EXISTING DATA ONLY ──────────
  // Current focus / next milestone from the roadmap.
  const focus = deriveFocus(stages, client.estimated_launch_date);

  // Attention: overdue invoices (derived, per currency), open client questions,
  // and outstanding required assets (waiting-on-client). No Planner reads.
  const overdueByCurrency: Record<string, number> = {};
  for (const inv of billing.invoices) {
    if (inv.derivedStatus === "overdue") {
      overdueByCurrency[inv.currency] =
        (overdueByCurrency[inv.currency] ?? 0) + inv.balance;
    }
  }
  const openQuestions = updateQuestions.filter((q) => q.status === "open").length;
  const readinessPending =
    readiness.hasItems && !assetsReceived
      ? Math.max(0, readiness.totalItems - readiness.totalDone)
      : 0;
  const attention = deriveAttention({
    overdueByCurrency,
    overdueCount: billing.kpis.overdueCount,
    openQuestions,
    readinessPending,
  });

  // Success Manager for display (assigned → default → none). Assignment itself
  // stays in Work › Project settings; Command Centre only surfaces it.
  const successManager =
    teamMembers.find((m) => m.id === client.success_manager_id) ??
    teamMembers.find((m) => m.is_default) ??
    null;

  // Bbettr-built website (Slice 2D) — read-only surfacing in Command Centre;
  // editing lives in Work › Website. Single source of truth on the client row.
  const websiteView = deriveWebsiteState({
    previewUrl: client.website_preview_url,
    liveUrl: client.website_live_url,
  });

  // Website operational-state signals (Slice 2E) — derived from the roadmap +
  // website URLs; drives the read-only Website status in Services.
  const websiteSignals = {
    liveUrl: client.website_live_url,
    previewUrl: client.website_preview_url,
    launchCompleted:
      stages.find((s) => s.name === "Launch")?.status === "completed",
    hasRoadmapProgress: stages.some(
      (s) => s.status === "in_progress" || s.status === "completed"
    ),
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
              {/* 1. OVERVIEW — relationship + current position, full width. */}
              <Card>
                <CardContent className="space-y-5 p-5">
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Account status">
                      <ClientStatusControl clientId={client.id} status={client.status} />
                    </Field>
                    <Field label="Success Manager">
                      {successManager ? (
                        <span className="flex items-center gap-1.5 text-sm font-medium text-ink-900">
                          <UserRound className="h-4 w-4 shrink-0 text-ink-400" />
                          <span className="truncate">
                            {successManager.name}
                            {successManager.role && (
                              <span className="text-ink-400"> · {successManager.role}</span>
                            )}
                          </span>
                        </span>
                      ) : (
                        <span className="text-sm text-ink-400">Unassigned</span>
                      )}
                    </Field>
                    <Field label="Estimated launch">
                      <span className="text-sm font-medium text-ink-900">
                        {client.estimated_launch_date
                          ? format(new Date(client.estimated_launch_date), "d MMM yyyy")
                          : "—"}
                      </span>
                    </Field>
                    <Field label="Client since">
                      <span className="text-sm font-medium text-ink-900">
                        {format(new Date(client.created_at), "d MMM yyyy")}
                      </span>
                    </Field>
                  </div>

                  <div className="rounded-xl border border-ink-100 bg-ink-50/50 p-4">
                    {focus.hasStages ? (
                      focus.allComplete ? (
                        <p className="text-sm font-medium text-emerald-700">
                          All project stages complete.
                        </p>
                      ) : (
                        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                          <FocusCell label="Current focus" value={focus.currentLabel} />
                          <FocusCell label="Next milestone" value={focus.nextLabel} />
                          <div>
                            <p className="text-xs font-medium text-ink-400">Target date</p>
                            <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                              <CalendarClock className="h-4 w-4 text-ink-400" />
                              {focus.etaDate
                                ? format(new Date(focus.etaDate), "d MMM yyyy")
                                : "Not set"}
                            </p>
                          </div>
                        </div>
                      )
                    ) : (
                      <p className="text-sm text-ink-400">
                        No project roadmap yet — set it up in the Work section.
                      </p>
                    )}
                  </div>

                  {websiteView.state !== "none" && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-ink-100 pt-4 text-sm">
                      <span className="font-medium text-ink-500">Website</span>
                      <span
                        className={
                          websiteView.state === "live"
                            ? "font-medium text-emerald-700"
                            : "text-ink-600"
                        }
                      >
                        · {websiteView.state === "live" ? "Live" : "In development"}
                      </span>
                      <a
                        href={websiteView.url ?? "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto flex items-center gap-1 font-medium text-brand-600 hover:text-brand-700"
                      >
                        {websiteView.state === "live" ? "Open" : "Open preview"}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 2. ATTENTION — prominent only when something needs it. */}
              {attention.length > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-800">
                    <AlertTriangle className="h-4 w-4" />
                    Needs attention
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {attention.map((a) => (
                      <span
                        key={a.kind}
                        className={cn(
                          "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium",
                          a.tone === "danger"
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-800"
                        )}
                      >
                        {a.label}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="px-1 text-sm text-ink-400">Nothing needs attention right now.</p>
              )}

              {/* 3. SERVICES — full-width breathing room. */}
              <Card>
                <CardHeader>
                  <CardTitle>Services</CardTitle>
                </CardHeader>
                <CardContent>
                  <ClientServicesManager
                    clientId={client.id}
                    clientName={client.name}
                    services={services}
                    websiteSignals={websiteSignals}
                    onboardingServices={onboardingServices}
                    onViewOnboarding={() => navigate("work")}
                  />
                </CardContent>
              </Card>

              {/* 4. CONTACT — compact, lower in the hierarchy. */}
              <Card>
                <CardHeader>
                  <CardTitle>Contact</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-3">
                  <InfoRow icon={User} label="Contact" value={client.contact_name} />
                  <InfoRow icon={Mail} label="Email" value={client.contact_email} />
                  <InfoRow icon={Phone} label="Phone" value={client.contact_phone} />
                </CardContent>
              </Card>

              {/* 5. PORTAL ACCESS — compact default; full actions behind Manage. */}
              <PortalAccessSummary
                clientId={client.id}
                portalUrl={portalUrl}
                access={portalAccess}
              />

              {/* 6. ADVANCED — Danger Zone lives ONCE, collapsed, at the bottom. */}
              <Disclosure title="Advanced">
                <DangerZone clientId={client.id} clientName={client.name} />
              </Disclosure>
            </div>
          )}

          {active === "work" && (
            <div className="space-y-6">
              {/* CURRENT PROJECT / DELIVERY — the core, always visible first. */}
              <AssetsReceivedControl
                clientId={client.id}
                readiness={readiness}
                assetsReceived={assetsReceived}
              />
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
                  <ActivityManager
                    clientId={client.id}
                    events={activity}
                    hasMore={activityHasMore}
                  />
                </CardContent>
              </Card>

              {/* CLIENT COMMUNICATION — quick actions + open questions. */}
              <GroupLabel>Client communication</GroupLabel>
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
                <UpdateQuestionsPanel questions={updateQuestions} />
              </div>

              {/* SECONDARY / OCCASIONAL — progressive disclosure (collapsed). */}
              <GroupLabel>Settings &amp; context</GroupLabel>
              <Disclosure title="Update history">
                {updates.length > 0 ? (
                  <UpdatesTimeline updates={updates} reactions={updateReactions} />
                ) : (
                  <p className="py-4 text-center text-sm text-ink-400">
                    No updates posted yet.
                  </p>
                )}
              </Disclosure>
              <Disclosure title="Project settings">
                <ProjectSettingsManager
                  clientId={client.id}
                  estimatedLaunchDate={client.estimated_launch_date}
                  successManagerId={client.success_manager_id}
                  teamMembers={teamMembers}
                />
              </Disclosure>
              <Disclosure title="Website">
                <WebsiteUrlsManager
                  clientId={client.id}
                  previewUrl={client.website_preview_url}
                  liveUrl={client.website_live_url}
                />
              </Disclosure>
              <Disclosure title="Onboarding answers">
                {onboarding.length > 0 ? (
                  <div className="space-y-4">
                    {onboarding.map((sub) => (
                      <Card key={sub.id}>
                        <CardHeader className="flex-row items-center justify-between">
                          <CardTitle>{getService(sub.service).name}</CardTitle>
                          <OnboardingStatusBadge status={sub.status} />
                        </CardHeader>
                        <CardContent>
                          <SubmissionView data={sub.data} />
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={ClipboardList}
                    title="No onboarding submitted yet"
                    description="The client hasn't started their onboarding."
                  />
                )}
              </Disclosure>
              <Disclosure title="Intake pipeline">
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
              </Disclosure>
            </div>
          )}

          {active === "documents" && (
            <ClientDocumentsSection
              clientId={client.id}
              contracts={contracts}
              files={files}
              reports={reports}
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

/** A labelled Command Centre field: small caption above its value/control. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs font-medium text-ink-400">{label}</p>
      {children}
    </div>
  );
}

/** A compact current-focus / next-milestone cell. */
function FocusCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-400">{label}</p>
      <p className="text-sm font-semibold text-ink-900">{value ?? "—"}</p>
    </div>
  );
}

/** A labelled hairline that separates the delivery core from lower-priority groups. */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">
        {children}
      </span>
      <span className="h-px flex-1 bg-ink-100" />
    </div>
  );
}

/** Collapsed-by-default disclosure for occasional/legacy context inside Work. */
function Disclosure({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-xl border border-ink-100 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-ink-700 hover:text-ink-900 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 text-ink-400 transition-transform group-open:rotate-90" />
        {title}
      </summary>
      <div className="border-t border-ink-100 p-4">{children}</div>
    </details>
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
