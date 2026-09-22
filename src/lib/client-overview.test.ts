import { describe, it, expect } from "vitest";
import {
  buildClientOverview,
  type BuildOverviewInput,
  type OverviewServiceInput,
  type OverviewNotificationInput,
} from "./client-overview";
import { canonicalProjectState, type ProjectStageInput } from "./project-state";

// ── Fixtures ────────────────────────────────────────────────────────────────

const DEFAULT_STAGES = [
  "Contract Signed",
  "Onboarding Submitted",
  "Assets Received",
  "In Development",
  "Review Stage",
  "Launch",
];
function roadmap(statuses: string[], dates: (string | null)[] = []): ProjectStageInput[] {
  return DEFAULT_STAGES.map((name, i) => ({
    name,
    status: statuses[i] ?? "pending",
    position: i + 1,
    target_date: dates[i] ?? null,
  }));
}

const websiteService = (
  operational: OverviewServiceInput["operational"] = "in_progress"
): OverviewServiceInput => ({
  service: "website",
  name: "Website Design",
  statusLabel: "In development",
  operational,
});
const adsService = (
  operational: OverviewServiceInput["operational"] = "active"
): OverviewServiceInput => ({
  service: "google_ads",
  name: "Google Ads",
  statusLabel: "Active",
  operational,
});

function build(overrides: Partial<BuildOverviewInput> = {}) {
  const stages = overrides.project
    ? []
    : roadmap(["completed", "completed", "completed", "in_progress", "pending", "pending"]);
  const project =
    overrides.project ??
    canonicalProjectState(stages, { estimatedLaunchDate: "2026-10-01" });
  const input: BuildOverviewInput = {
    clientName: "Imatec",
    project,
    website: { previewUrl: null, liveUrl: null },
    services: [websiteService()],
    onboardingComplete: true,
    readinessPending: 0,
    actionItems: [],
    ...overrides,
  };
  return buildClientOverview(input);
}

const proj = (statuses: string[], dates?: (string | null)[], eld = "2026-10-01") =>
  canonicalProjectState(roadmap(statuses, dates), { estimatedLaunchDate: eld });

// ── 1. New client / onboarding incomplete ───────────────────────────────────

describe("1. New website client, onboarding incomplete", () => {
  it("primary action is onboarding, header is getting-started", () => {
    const m = build({
      project: proj(["pending", "pending", "pending", "pending", "pending", "pending"]),
      onboardingComplete: false,
    });
    expect(m.kind).toBe("website");
    expect(m.attention.hasAction).toBe(true);
    expect(m.attention.primary?.kind).toBe("onboarding");
    expect(m.attention.primary?.href).toBe("/dashboard/onboarding");
    expect(m.header.headline).toMatch(/getting started/i);
    expect(m.header.showProgress).toBe(true); // stages exist → 0% with context
    expect(m.header.stageContext).toBe("Discovery · Stage 1 of 6");
  });
});

// ── 2–7. Website lifecycle phases ────────────────────────────────────────────

describe("2. Website — Strategy", () => {
  it("plans-your-website copy, progress paired with stage", () => {
    const m = build({ project: proj(["completed", "in_progress", "pending", "pending", "pending", "pending"]) });
    expect(m.header.headline).toMatch(/planning your website/i);
    expect(m.header.progressPercent).toBe(17);
    expect(m.header.stageContext).toBe("Strategy · Stage 2 of 6");
    expect(m.header.nextMilestoneLabel).toBe("Design");
  });
});

describe("3. Website — Design", () => {
  it("being-designed copy", () => {
    const m = build({ project: proj(["completed", "completed", "in_progress", "pending", "pending", "pending"]) });
    expect(m.header.headline).toMatch(/being designed/i);
    expect(m.header.stageContext).toBe("Design · Stage 3 of 6");
  });
});

describe("4. Website — Development, no preview", () => {
  it("in-development copy, no preview CTA", () => {
    const m = build({
      project: proj(["completed", "completed", "completed", "in_progress", "pending", "pending"]),
      website: { previewUrl: null, liveUrl: null },
    });
    expect(m.header.headline).toMatch(/in development/i);
    expect(m.header.progressPercent).toBe(50);
    expect(m.header.stageContext).toBe("Development · Stage 4 of 6");
    expect(m.header.cta).toBeNull();
  });
});

describe("5. Website — Development + preview URL", () => {
  it("offers a preview CTA to the preview URL", () => {
    const m = build({
      project: proj(["completed", "completed", "completed", "in_progress", "pending", "pending"]),
      website: { previewUrl: "https://preview.test/imatec", liveUrl: null },
    });
    expect(m.header.cta).toEqual({
      label: "View website preview",
      href: "https://preview.test/imatec",
      kind: "preview",
    });
  });
});

describe("6. Website — Review/testing", () => {
  it("in-review header with NO header CTA; review becomes the primary action when a preview exists", () => {
    const m = build({
      project: proj(["completed", "completed", "completed", "completed", "in_progress", "pending"]),
      website: { previewUrl: "https://preview.test/imatec", liveUrl: null },
    });
    expect(m.header.lifecycle).toBe("in_review");
    expect(m.header.headline).toMatch(/in review/i);
    expect(m.header.cta).toBeNull(); // CTA moves to the attention strip
    expect(m.attention.primary?.kind).toBe("review");
    expect(m.attention.primary?.href).toBe("https://preview.test/imatec");
    expect(m.attention.primary?.external).toBe(true);
  });

  it("in review WITHOUT a preview → no review action, calm reassurance", () => {
    const m = build({
      project: proj(["completed", "completed", "completed", "completed", "in_progress", "pending"]),
      website: { previewUrl: null, liveUrl: null },
    });
    expect(m.header.lifecycle).toBe("in_review");
    expect(m.attention.hasAction).toBe(false);
    expect(m.attention.primary).toBeNull();
  });
});

describe("7. Website — Launch pending (Launch stage in progress)", () => {
  it("getting-ready-to-launch copy, not yet launched", () => {
    const m = build({ project: proj(["completed", "completed", "completed", "completed", "completed", "in_progress"]) });
    expect(m.header.launched).toBe(false);
    expect(m.header.headline).toMatch(/ready to launch/i);
    expect(m.header.stageContext).toBe("Launch · Stage 6 of 6");
    expect(m.postLaunch).toBe(false);
  });
});

// ── 8–9. Launched ────────────────────────────────────────────────────────────

describe("8. Website — Launched + live URL", () => {
  it("live headline, Visit CTA to the live URL, progress suppressed, post-launch", () => {
    const m = build({
      project: proj(["completed", "completed", "completed", "completed", "completed", "completed"]),
      website: { previewUrl: "https://preview.test/x", liveUrl: "https://imatec.co.za" },
    });
    expect(m.header.headline).toMatch(/is live/i);
    expect(m.header.showProgress).toBe(false);
    expect(m.header.stageContext).toBeNull();
    expect(m.header.nextMilestoneLabel).toBeNull();
    expect(m.header.cta).toEqual({
      label: "Visit your website",
      href: "https://imatec.co.za",
      kind: "visit",
    });
    expect(m.postLaunch).toBe(true);
  });
});

describe("9. Website — Launch completed but live URL missing", () => {
  it("still live; Visit CTA falls back to the preview URL", () => {
    const m = build({
      project: proj(["completed", "completed", "completed", "completed", "completed", "completed"]),
      website: { previewUrl: "https://preview.test/x", liveUrl: null },
    });
    expect(m.header.launched).toBe(true);
    expect(m.header.cta?.kind).toBe("visit");
    expect(m.header.cta?.href).toBe("https://preview.test/x");
  });

  it("launched with NO urls at all → live headline, no CTA (never a fake link)", () => {
    const m = build({
      project: proj(["completed", "completed", "completed", "completed", "completed", "completed"]),
      website: { previewUrl: null, liveUrl: null },
    });
    expect(m.header.launched).toBe(true);
    expect(m.header.cta).toBeNull();
  });
});

// ── 10–11. Non-website / multi-service ───────────────────────────────────────

describe("10. Ads-only client", () => {
  it("is a services overview — NO website development experience", () => {
    const m = build({
      project: canonicalProjectState([]), // ads-only: typically no website roadmap
      services: [adsService("active")],
    });
    expect(m.kind).toBe("services");
    expect(m.header.eyebrow).toBe("Your services");
    expect(m.header.headline).not.toMatch(/website/i);
    expect(m.header.headline).toMatch(/live/i);
    expect(m.header.showProgress).toBe(false);
    expect(m.showJourney).toBe(false);
    expect(m.showServices).toBe(true);
  });

  it("ads still in setup → getting-ready copy", () => {
    const m = build({
      project: canonicalProjectState([]),
      services: [adsService("setup")],
    });
    expect(m.header.headline).toMatch(/getting your campaigns ready/i);
  });
});

describe("11. Website + Ads client", () => {
  it("stays website-led but shows the services section", () => {
    const m = build({
      project: proj(["completed", "completed", "completed", "in_progress", "pending", "pending"]),
      services: [websiteService(), adsService("active")],
    });
    expect(m.kind).toBe("website");
    expect(m.header.eyebrow).toBe("Your website");
    expect(m.showServices).toBe(true); // >1 service → useful
    expect(m.showJourney).toBe(true);
  });
});

describe("website-only client hides the services card", () => {
  it("showServices is false for a single website service", () => {
    const m = build({ services: [websiteService()] });
    expect(m.showServices).toBe(false);
  });
});

// ── 12–13. Action vs reassurance ─────────────────────────────────────────────

describe("12. Client with action required", () => {
  it("explicit notifications outrank everything and expose the resolve id", () => {
    const items: OverviewNotificationInput[] = [
      { id: "n1", title: "Pay outstanding invoice", body: "R2 500 due", link: "/dashboard/billing" },
      { id: "n2", title: "Provide DNS access", body: null, link: null },
    ];
    const m = build({ actionItems: items, onboardingComplete: false });
    expect(m.attention.primary?.kind).toBe("notification");
    expect(m.attention.primary?.title).toBe("Pay outstanding invoice");
    expect(m.attention.primary?.notificationId).toBe("n1");
    // onboarding is still incomplete → it appears among the others, after both notifications
    expect(m.attention.others.map((a) => a.kind)).toEqual(["notification", "onboarding"]);
  });

  it("readiness surfaces only after onboarding is complete", () => {
    const m = build({ onboardingComplete: true, readinessPending: 2 });
    expect(m.attention.primary?.kind).toBe("readiness");
    expect(m.attention.primary?.title).toMatch(/2 things/i);
  });

  it("onboarding incomplete suppresses the granular readiness action", () => {
    const m = build({ onboardingComplete: false, readinessPending: 3 });
    expect(m.attention.primary?.kind).toBe("onboarding");
    expect(m.attention.others.some((a) => a.kind === "readiness")).toBe(false);
  });
});

describe("13. Client with no action required", () => {
  it("returns a calm reassurance state — never silence", () => {
    const m = build({ onboardingComplete: true, readinessPending: 0, actionItems: [] });
    expect(m.attention.hasAction).toBe(false);
    expect(m.attention.primary).toBeNull();
    expect(m.attention.others).toEqual([]);
  });

  it("a zero-service brand-new client is NOT nagged to onboard", () => {
    const m = build({
      project: canonicalProjectState([]),
      services: [],
      onboardingComplete: false,
    });
    expect(m.kind).toBe("getting_started");
    expect(m.attention.hasAction).toBe(false);
    expect(m.header.headline).toMatch(/welcome/i);
  });
});

// ── 16–17. Robustness (long strings never break the model) ───────────────────

describe("16–17. Long business name / long update content don't affect logic", () => {
  it("passes a long client name through untouched", () => {
    const long = "The Really Quite Extraordinarily Long Business Name (Pty) Ltd t/a Something";
    const m = build({ clientName: long });
    expect(m.clientName).toBe(long);
  });
});

// ── Cross-cutting invariants ─────────────────────────────────────────────────

describe("invariants", () => {
  it("progress is always paired with stage context while in flight (never stands alone)", () => {
    for (const statuses of [
      ["in_progress", "pending", "pending", "pending", "pending", "pending"],
      ["completed", "completed", "in_progress", "pending", "pending", "pending"],
      ["completed", "completed", "completed", "completed", "in_progress", "pending"],
    ]) {
      const m = build({ project: proj(statuses) });
      if (m.header.showProgress) {
        expect(m.header.stageContext).not.toBeNull();
      }
    }
  });

  it("never exposes an internal stage name in header copy", () => {
    const m = build({
      project: canonicalProjectState(
        [{ name: "Secret Internal Phase", status: "in_progress", position: 1, target_date: null }],
        {}
      ),
      website: { previewUrl: null, liveUrl: null },
    });
    expect(m.header.headline).not.toMatch(/secret internal phase/i);
    expect(m.header.subcopy).not.toMatch(/secret internal phase/i);
  });

  it("blank website URLs are treated as absent (no preview CTA)", () => {
    const m = build({
      project: proj(["completed", "completed", "completed", "in_progress", "pending", "pending"]),
      website: { previewUrl: "   ", liveUrl: "" },
    });
    expect(m.header.cta).toBeNull();
  });
});
