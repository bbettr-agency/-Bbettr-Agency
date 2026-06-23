import "server-only";
import { sendTransactionalEmail, type SendResult } from "@/lib/email/resend";
import { renderEmail } from "@/lib/email/templates";
import { formatCurrency } from "@/lib/utils";

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

/** YYYY-MM-DD (or "—") for an ISO date string, for plain-text email lines. */
function emailDate(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "—";
}

interface InvoiceEmailInput {
  to: string;
  clientName: string | null;
  invoiceNumber: string;
  amount: number;
  currency: string;
  dueAt: string | null;
  /** Client-facing status label, e.g. "Outstanding" / "Overdue" / "Paid". */
  statusLabel: string;
}

const INVOICES_URL = `${APP_URL}/dashboard/invoices`;

/**
 * Notify a client that a new invoice is available to view in the portal. Sent
 * only when an invoice becomes client-visible (created-as-sent or marked sent);
 * never for drafts. Best-effort (never throws).
 */
export async function sendInvoiceAvailableEmail(
  opts: InvoiceEmailInput
): Promise<SendResult> {
  const html = renderEmail({
    preheader: `Invoice ${opts.invoiceNumber} is available in your portal.`,
    heading: "A new invoice is available",
    paragraphs: [
      `Hi ${opts.clientName || "there"},`,
      "A new invoice is now available to view and download in your Bbettr Agency portal.",
      `Invoice number: ${opts.invoiceNumber}`,
      `Amount: ${formatCurrency(opts.amount, opts.currency)}`,
      `Due date: ${emailDate(opts.dueAt)}`,
      `Status: ${opts.statusLabel}`,
    ],
    cta: { label: "View invoice", url: INVOICES_URL },
    footnote: "You can view and download all your invoices any time in the portal.",
  });

  return sendTransactionalEmail({
    to: opts.to,
    subject: "New invoice available in your Bbettr portal",
    html,
  });
}

/**
 * Manual payment reminder for an outstanding/overdue invoice. Triggered by an
 * admin clicking "Send reminder". Best-effort (never throws).
 */
export async function sendInvoiceReminderEmail(
  opts: InvoiceEmailInput
): Promise<SendResult> {
  const html = renderEmail({
    preheader: `A reminder about invoice ${opts.invoiceNumber}.`,
    heading: "Invoice reminder",
    paragraphs: [
      `Hi ${opts.clientName || "there"},`,
      "This is a friendly reminder about the following invoice on your account:",
      `Invoice number: ${opts.invoiceNumber}`,
      `Amount: ${formatCurrency(opts.amount, opts.currency)}`,
      `Due date: ${emailDate(opts.dueAt)}`,
      `Current status: ${opts.statusLabel}`,
    ],
    cta: { label: "View invoice", url: INVOICES_URL },
    footnote: "If you've already paid, please disregard this reminder.",
  });

  return sendTransactionalEmail({
    to: opts.to,
    subject: "Invoice reminder from Bbettr Agency",
    html,
  });
}
