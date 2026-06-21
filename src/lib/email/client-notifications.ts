import "server-only";
import { sendTransactionalEmail, type SendResult } from "@/lib/email/resend";
import { renderEmail } from "@/lib/email/templates";

/**
 * Client-flow welcome / credentials email.
 *
 * Mirrors the rep welcome email (see rep-notifications.ts): branded Resend HTML
 * containing everything a client needs to sign in — portal URL, login email and
 * a temporary password. The password is ALWAYS passed in by the caller (the one
 * generated at provisioning, or a freshly reset one) and is NEVER read from
 * storage (Supabase keeps only the hash), so stored passwords are never exposed.
 *
 * Best-effort: sendTransactionalEmail returns { ok:false } (never throws) when
 * RESEND_API_KEY is absent, so a missing key can't break the triggering action.
 */

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.bbettragency.com";

export async function sendClientWelcomeEmail(opts: {
  to: string;
  name: string | null;
  loginEmail: string;
  password: string;
}): Promise<SendResult> {
  const loginUrl = `${APP_URL}/login`;

  const html = renderEmail({
    preheader: "Your Bbettr Agency client portal login details.",
    heading: "Welcome to your Bbettr Agency portal",
    paragraphs: [
      `Hi ${opts.name || "there"},`,
      "Your client portal is ready. Use the details below to sign in:",
      `Portal URL: ${loginUrl}`,
      `Email: ${opts.loginEmail}`,
      `Temporary password: ${opts.password}`,
      "For your security, please change your password after you sign in.",
    ],
    cta: { label: "Sign in to your portal", url: loginUrl },
    footnote: "If you didn't expect this email, please contact the team.",
  });

  return sendTransactionalEmail({
    to: opts.to,
    subject: "Your Bbettr Agency portal access",
    html,
  });
}

/** Agency inbox that receives onboarding assistance requests. */
const AGENCY_INBOX = "info@bbettragency.com";

/**
 * Notify the agency inbox that a client booked an assisted onboarding session
 * (Google Meet). Best-effort: returns { ok:false } (never throws) when
 * RESEND_API_KEY is absent, so a missing key can't break onboarding submission.
 */
export async function sendOnboardingAssistanceEmail(opts: {
  businessName: string;
  contactName: string | null;
  serviceName: string;
  preferredDate?: string | null;
  preferredTime?: string | null;
  email: string | null;
  phone: string | null;
  notes?: string | null;
  submissionId: string;
}): Promise<SendResult> {
  const html = renderEmail({
    preheader: `New onboarding assistance request from ${opts.businessName}`,
    heading: "New onboarding assistance request",
    paragraphs: [
      `${opts.businessName} requested help completing their onboarding.`,
      `Business Name: ${opts.businessName}`,
      `Contact Name: ${opts.contactName || "—"}`,
      `Service Type: ${opts.serviceName}`,
      `Preferred Date: ${opts.preferredDate || "—"}`,
      `Preferred Time: ${opts.preferredTime || "—"}`,
      `Email: ${opts.email || "—"}`,
      `Phone: ${opts.phone || "—"}`,
      `Notes: ${opts.notes || "—"}`,
      `Submission ID: ${opts.submissionId}`,
    ],
    cta: { label: "View clients in admin", url: `${APP_URL}/admin/clients` },
  });

  return sendTransactionalEmail({
    to: AGENCY_INBOX,
    subject: `New Onboarding Assistance Request - ${opts.businessName}`,
    html,
  });
}
