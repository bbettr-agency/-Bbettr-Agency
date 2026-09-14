/**
 * Data assembly for the admin "Download onboarding PDF" feature — pure, no I/O,
 * no React. The PDF's content is derived from the SAME schema-driven presenter as
 * the on-screen summary (`presentOnboarding`), so the document and the browser
 * view can never drift. This module only shapes metadata + a safe filename.
 */
import { presentOnboarding, type PresentedOnboarding } from "./onboarding-present";
import { getService } from "./services";
import type { ServiceType, OnboardingStatus } from "./database.types";

const AGENCY = "Bbettr Agency";

export interface OnboardingPdfMeta {
  agency: string;
  businessName: string;
  serviceName: string;
  status: OnboardingStatus;
  submittedAt: string | null;
}
export interface OnboardingPdfModel {
  meta: OnboardingPdfMeta;
  presented: PresentedOnboarding;
}

/** Only a submitted or approved onboarding may be exported (never a draft). */
export function isDownloadableOnboardingStatus(status: OnboardingStatus): boolean {
  return status === "submitted" || status === "approved";
}

/** Slugify a display string into a safe filename segment (no path chars). */
function slug(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Safe, human-sensible download filename, e.g.
 * "A-S-Wholesalers-Haier-Hvac-Website-Design-Onboarding.pdf". Never contains
 * path separators, so it cannot be used for path traversal in the header.
 */
export function onboardingPdfFilename(
  businessName: string | null | undefined,
  serviceName: string
): string {
  const biz = slug(businessName ?? "") || "Client";
  const svc = slug(serviceName) || "Service";
  return `${biz}-${svc}-Onboarding.pdf`;
}

/**
 * Build the full PDF model. `presented` is produced by the shared presenter, so
 * the document shows exactly the sections/labels/values (and legacy "Additional
 * details" handling) as the on-screen summary — never raw keys or JSON.
 */
export function buildOnboardingPdfModel(input: {
  service: ServiceType;
  data: Record<string, unknown> | null | undefined;
  businessName: string | null | undefined;
  status: OnboardingStatus;
  submittedAt: string | null;
}): OnboardingPdfModel {
  return {
    meta: {
      agency: AGENCY,
      businessName: (input.businessName ?? "").trim() || "Client",
      serviceName: getService(input.service).name,
      status: input.status,
      submittedAt: input.submittedAt,
    },
    presented: presentOnboarding(input.service, input.data),
  };
}
