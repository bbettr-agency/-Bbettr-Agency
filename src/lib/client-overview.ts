/**
 * Client Overview view model (CX2). Pure, no I/O, no JSX.
 *
 * This is the ONE place that decides what the client Overview says, so the page
 * only composes presentational pieces from a ready-made model. It answers, in
 * order, the four questions a client actually has when they log in:
 *
 *   1. Do you need anything from me?  → `attention` (one authoritative surface)
 *   2. Where are we?                  → `header` (project / service state)
 *   3. What happens next?             → `header.nextMilestone*`
 *   4. What is Bbettr doing?          → the latest curated update (page-level)
 *
 * Project state is taken ENTIRELY from the canonical CX1 layer (ProjectState) —
 * this module never re-derives progress, current stage, launch or dates. Client
 * labels come pre-resolved through the CX1 presentation layer, so internal stage
 * names never leak here.
 */
import type { ProjectState, ProjectLifecycle } from "./project-state";
import { SAFE_STAGE_LABEL } from "./journey";
import type { ServiceType } from "./database.types";
import type { OperationalStatus } from "./service-operational-state";

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface OverviewServiceInput {
  service: ServiceType;
  /** Display name (e.g. "Website Design"). */
  name: string;
  /** Friendly, client-facing status label (already resolved). */
  statusLabel: string;
  /** Resolved operational status enum. */
  operational: OperationalStatus;
}

/** An explicit action-required notification (notifications.action_required). */
export interface OverviewNotificationInput {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
}

export interface BuildOverviewInput {
  clientName: string;
  /** Canonical project state (CX1). */
  project: ProjectState;
  website: { previewUrl: string | null; liveUrl: string | null };
  services: OverviewServiceInput[];
  /** isOnboardingComplete(services) — every purchased service submitted/approved. */
  onboardingComplete: boolean;
  /**
   * Count of still-outstanding required onboarding assets/access, ALREADY gated
   * to 0 once the admin has marked assets received. Surfaced only after
   * onboarding is otherwise complete (else the onboarding action covers it).
   */
  readinessPending: number;
  /** Explicit action-required notifications, highest-authority actions. */
  actionItems: OverviewNotificationInput[];
}

// ── Outputs ─────────────────────────────────────────────────────────────────

export type OverviewKind = "website" | "services" | "getting_started";

export type OverviewActionKind =
  | "notification"
  | "onboarding"
  | "readiness"
  | "review";

export interface OverviewActionView {
  kind: OverviewActionKind;
  title: string;
  body: string | null;
  href: string | null;
  ctaLabel: string;
  /** External link (open in a new tab) — true for a website preview review. */
  external: boolean;
  /** Notification id — enables the existing "mark done" resolve flow (else null). */
  notificationId: string | null;
}

export interface OverviewAttentionView {
  hasAction: boolean;
  /** The single highest-priority action, or null when nothing is needed. */
  primary: OverviewActionView | null;
  /** Any further actions, so a client can still reach them without noise. */
  others: OverviewActionView[];
}

export type WebsiteCtaKind = "preview" | "visit";

export interface OverviewHeaderView {
  kind: OverviewKind;
  /** Small uppercase context line, e.g. "Your website". */
  eyebrow: string;
  headline: string;
  subcopy: string;
  lifecycle: ProjectLifecycle;
  launched: boolean;
  /** Whether to show the progress treatment (suppressed once launched). */
  showProgress: boolean;
  progressPercent: number;
  /** Progress is NEVER shown alone — this pairs it, e.g. "Development · Stage 4 of 6". */
  stageContext: string | null;
  nextMilestoneLabel: string | null;
  nextMilestoneDate: string | null;
  estimatedLaunchDate: string | null;
  /** Lifecycle CTA (preview / visit). Review is surfaced as an action instead. */
  cta: { label: string; href: string; kind: WebsiteCtaKind } | null;
}

export interface OverviewModel {
  clientName: string;
  kind: OverviewKind;
  attention: OverviewAttentionView;
  header: OverviewHeaderView;
  services: OverviewServiceInput[];
  /** Whether to render the (secondary) project journey — website with stages. */
  showJourney: boolean;
  /** Whether to render the services section (hidden for website-only). */
  showServices: boolean;
  /** Launched — the page reduces development dominance and promotes the live site. */
  postLaunch: boolean;
}

// ── Copy tables (client-facing, calm & jargon-free) ─────────────────────────

const IN_PROGRESS_COPY: Record<string, { headline: string; subcopy: string }> = {
  Discovery: {
    headline: "We’re getting your website underway",
    subcopy: "We’re getting to know your business, your goals and your audience.",
  },
  Strategy: {
    headline: "We’re planning your website",
    subcopy: "We’re shaping the structure and strategy for your new site.",
  },
  Design: {
    headline: "Your website is being designed",
    subcopy: "Our team is crafting the look and feel of your site.",
  },
  Development: {
    headline: "Your website is in development",
    subcopy: "We’re building the core pages of your new website.",
  },
  Testing: {
    headline: "Your website is in review",
    subcopy: "We’re testing and polishing everything before launch.",
  },
  Launch: {
    headline: "Your website is getting ready to launch",
    subcopy: "We’re preparing everything for your go-live.",
  },
};

const GENERIC_IN_PROGRESS = {
  headline: "Your website project is underway",
  subcopy: "Our team is making progress on your site.",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function nonEmpty(v: string | null | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ── Builder ─────────────────────────────────────────────────────────────────

export function buildClientOverview(input: BuildOverviewInput): OverviewModel {
  const { project, website, services, clientName } = input;
  const hasWebsiteService = services.some((s) => s.service === "website");
  const kind: OverviewKind = hasWebsiteService
    ? "website"
    : services.length > 0
      ? "services"
      : "getting_started";

  const previewUrl = nonEmpty(website.previewUrl) ? website.previewUrl : null;
  const liveUrl = nonEmpty(website.liveUrl) ? website.liveUrl : null;

  const attention = buildAttention(input, kind, previewUrl);
  const header =
    kind === "website"
      ? websiteHeader(project, previewUrl, liveUrl)
      : kind === "services"
        ? servicesHeader(services)
        : gettingStartedHeader();

  return {
    clientName,
    kind,
    attention,
    header,
    services,
    showJourney: kind === "website" && project.hasStages,
    // Website-only clients don't need a services card merely naming their one
    // service; it earns its place for multi-service and services-only clients.
    showServices:
      services.length > 0 && (kind === "services" || services.length > 1),
    postLaunch: project.launched,
  };
}

/**
 * The single authoritative "do you need anything from me?" surface. Sources, in
 * priority order (best existing signals — NO CX4 migration, NO new records):
 *   1. explicit action-required notifications (admin-authored asks)
 *   2. onboarding not yet complete
 *   3. outstanding required assets/access (after onboarding is otherwise done)
 *   4. a website in review with a preview available (a genuine "please look")
 * When nothing is required we return a calm reassurance state — never silence.
 */
function buildAttention(
  input: BuildOverviewInput,
  kind: OverviewKind,
  previewUrl: string | null
): OverviewAttentionView {
  const actions: OverviewActionView[] = [];

  for (const n of input.actionItems) {
    actions.push({
      kind: "notification",
      title: n.title,
      body: n.body,
      href: n.link,
      ctaLabel: "Open",
      external: false,
      notificationId: n.id,
    });
  }

  // Onboarding only makes sense once a client actually has services to onboard.
  if (!input.onboardingComplete && input.services.length > 0) {
    actions.push({
      kind: "onboarding",
      title: "Complete your onboarding",
      body: "Fill in the details for your services so we can get started.",
      href: "/dashboard/onboarding",
      ctaLabel: "Continue onboarding",
      external: false,
      notificationId: null,
    });
  } else if (input.onboardingComplete && input.readinessPending > 0) {
    actions.push({
      kind: "readiness",
      title:
        input.readinessPending === 1
          ? "One more thing we need from you"
          : `${input.readinessPending} things we still need from you`,
      body: "Add the outstanding assets and access so we can keep moving.",
      href: "/dashboard/onboarding",
      ctaLabel: "Add your details",
      external: false,
      notificationId: null,
    });
  }

  // A website in review with a live preview is a real, data-backed request to
  // look — surfaced for display only (no notification record is created).
  if (
    kind === "website" &&
    input.project.lifecycle === "in_review" &&
    previewUrl
  ) {
    actions.push({
      kind: "review",
      title: "Review your website",
      body: "Your site is ready for you to look over before we launch.",
      href: previewUrl,
      ctaLabel: "Review your website",
      external: true,
      notificationId: null,
    });
  }

  return {
    hasAction: actions.length > 0,
    primary: actions[0] ?? null,
    others: actions.slice(1),
  };
}

function websiteHeader(
  project: ProjectState,
  previewUrl: string | null,
  liveUrl: string | null
): OverviewHeaderView {
  const stageLabel = project.current?.label ?? null;
  const pos = project.currentPosition;
  const total = project.totalStages;
  const launched = project.launched;

  const stageContext =
    !launched && stageLabel && pos !== null && total > 0
      ? `${stageLabel} · Stage ${pos} of ${total}`
      : null;

  const base = {
    kind: "website" as const,
    eyebrow: "Your website",
    lifecycle: project.lifecycle,
    launched,
    progressPercent: project.progressPercent,
    stageContext,
    nextMilestoneLabel: launched ? null : project.next?.label ?? null,
    nextMilestoneDate: launched ? null : project.next?.targetDate ?? null,
    estimatedLaunchDate: project.estimatedLaunchDate,
  };

  // Launched — reduce development dominance; promote the live site.
  if (launched) {
    const url = liveUrl ?? previewUrl;
    return {
      ...base,
      headline: "Your website is live",
      subcopy: "It’s out in the world — everything you need is right here.",
      showProgress: false,
      nextMilestoneLabel: null,
      nextMilestoneDate: null,
      cta: url ? { label: "Visit your website", href: url, kind: "visit" } : null,
    };
  }

  // In review — the review request lives in the attention strip, so no CTA here.
  if (project.lifecycle === "in_review") {
    return {
      ...base,
      headline: "Your website is in review",
      subcopy: "We’re doing our final checks and polish before launch.",
      showProgress: true,
      cta: null,
    };
  }

  // No stages at all — a calm getting-started state.
  if (!project.hasStages) {
    return {
      ...base,
      headline: "Your website project is getting started",
      subcopy:
        "We’re setting things up behind the scenes. We’ll reach out the moment we need anything.",
      showProgress: false,
      cta: null,
    };
  }

  // Not started (stages exist, nothing begun).
  if (project.lifecycle === "not_started") {
    return {
      ...base,
      headline: "Your website project is getting started",
      subcopy:
        "We’re setting things up behind the scenes. We’ll reach out the moment we need anything.",
      showProgress: true,
      cta: previewUrl
        ? { label: "View website preview", href: previewUrl, kind: "preview" }
        : null,
    };
  }

  // In progress — phase-specific copy from the client-safe stage label.
  const copy =
    (stageLabel && stageLabel !== SAFE_STAGE_LABEL
      ? IN_PROGRESS_COPY[stageLabel]
      : null) ?? GENERIC_IN_PROGRESS;

  return {
    ...base,
    headline: copy.headline,
    subcopy: copy.subcopy,
    showProgress: true,
    cta: previewUrl
      ? { label: "View website preview", href: previewUrl, kind: "preview" }
      : null,
  };
}

function servicesHeader(services: OverviewServiceInput[]): OverviewHeaderView {
  const anyActive = services.some((s) => s.operational === "active");
  const anySetup = services.some(
    (s) => s.operational === "setup" || s.operational === "in_progress"
  );

  const { headline, subcopy } = anyActive && !anySetup
    ? {
        headline: "Your campaigns are live",
        subcopy: "Everything is up and running — we’re managing it for you.",
      }
    : anyActive
      ? {
          headline: "Your marketing is up and running",
          subcopy: "Some services are live while we finish setting up the rest.",
        }
      : anySetup
        ? {
            headline: "We’re getting your campaigns ready",
            subcopy: "Our team is setting everything up behind the scenes.",
          }
        : {
            headline: "Your services are being set up",
            subcopy: "We’ll let you know the moment there’s something to see.",
          };

  return {
    kind: "services",
    eyebrow: "Your services",
    headline,
    subcopy,
    lifecycle: "in_progress",
    launched: false,
    showProgress: false,
    progressPercent: 0,
    stageContext: null,
    nextMilestoneLabel: null,
    nextMilestoneDate: null,
    estimatedLaunchDate: null,
    cta: null,
  };
}

function gettingStartedHeader(): OverviewHeaderView {
  return {
    kind: "getting_started",
    eyebrow: "Welcome",
    headline: "Welcome to Bbettr",
    subcopy:
      "We’re getting your account set up. Your Success Manager will be in touch shortly.",
    lifecycle: "not_started",
    launched: false,
    showProgress: false,
    progressPercent: 0,
    stageContext: null,
    nextMilestoneLabel: null,
    nextMilestoneDate: null,
    estimatedLaunchDate: null,
    cta: null,
  };
}
