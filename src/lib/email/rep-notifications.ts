import "server-only";
import { sendTransactionalEmail, type SendResult } from "@/lib/email/resend";
import { renderEmail } from "@/lib/email/templates";
import { formatCurrency } from "@/lib/utils";
import type { BillingType, ClientLocation } from "@/lib/database.types";

/**
 * Rep-flow transactional emails (welcome credentials + invoice-request events).
 *
 * Reuses the existing Resend sender (`sendTransactionalEmail`) and branded HTML
 * builder (`renderEmail`) — the same infrastructure as client notifications, so
 * nothing about the client email flow changes. Every function is best-effort:
 * `sendTransactionalEmail` returns `{ ok:false }` (never throws) when
 * RESEND_API_KEY is absent, so a missing key can't break the triggering action.
 */

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.bbettragency.com";

/** Agency inbox that receives new-invoice-request notifications. */
const AGENCY_INBOX = "info@bbettragency.com";

function billingLabel(b: BillingType): string {
  return b === "once_off" ? "Once-off" : "Monthly";
}

function locationLabel(l: ClientLocation): string {
  return l === "south_africa" ? "South Africa" : "International";
}

/**
 * Welcome email containing the rep's login credentials. The password is passed
 * in by the caller (generated at creation or freshly reset) — it is NEVER read
 * from storage, so stored passwords are never exposed.
 */
export async function sendRepWelcomeEmail(opts: {
  to: string;
  name: string | null;
  loginEmail: string;
  password: string;
}): Promise<SendResult> {
  const html = renderEmail({
    preheader: "Your Bbettr Agency rep portal login details.",
    heading: "Welcome to the Bbettr Agency rep portal",
    paragraphs: [
      `Hi ${opts.name || "there"},`,
      "Your sales rep account is ready. Use the details below to sign in:",
      `Login URL: ${APP_URL}/login`,
      `Email: ${opts.loginEmail}`,
      `Temporary password: ${opts.password}`,
      "For your security, please change your password after you sign in.",
    ],
    cta: { label: "Sign in to the rep portal", url: `${APP_URL}/login` },
    footnote: "If you didn't expect this email, please contact the team.",
  });

  return sendTransactionalEmail({
    to: opts.to,
    subject: "Your Bbettr Agency rep portal access",
    html,
  });
}

/** Notify the agency inbox that a rep raised a new invoice request. */
export async function sendInvoiceRequestEmail(opts: {
  repName: string;
  businessName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  packageName: string | null;
  amount: number;
  billingType: BillingType;
  location: ClientLocation;
}): Promise<SendResult> {
  const html = renderEmail({
    preheader: `New deal from ${opts.repName}: ${opts.businessName}`,
    heading: "New invoice request",
    paragraphs: [
      `${opts.repName} submitted a new deal for approval.`,
      `Rep: ${opts.repName}`,
      `Business: ${opts.businessName}`,
      `Client location: ${locationLabel(opts.location)}`,
      `Contact person: ${opts.contactName || "—"}`,
      `Email: ${opts.email || "—"}`,
      `Phone: ${opts.phone || "—"}`,
      `Package: ${opts.packageName || "—"}`,
      `Amount: ${formatCurrency(opts.amount)}`,
      `Billing type: ${billingLabel(opts.billingType)}`,
    ],
    cta: {
      label: "Review invoice requests",
      url: `${APP_URL}/admin/invoices`,
    },
  });

  return sendTransactionalEmail({
    to: AGENCY_INBOX,
    subject: `New invoice request from ${opts.repName}`,
    html,
  });
}

/** Tell the rep their invoice request was approved (incl. commission). */
export async function sendInvoiceApprovedEmail(opts: {
  to: string;
  businessName: string;
  packageName: string | null;
  amount: number;
  commission: number;
}): Promise<SendResult> {
  const html = renderEmail({
    preheader: `Your deal "${opts.businessName}" was approved.`,
    heading: "Your invoice request was approved",
    paragraphs: [
      "Good news — your deal has been approved.",
      `Business: ${opts.businessName}`,
      `Package: ${opts.packageName || "—"}`,
      `Amount: ${formatCurrency(opts.amount)}`,
      `Commission earned: ${formatCurrency(opts.commission)}`,
    ],
    cta: { label: "View your deals", url: `${APP_URL}/rep/deals` },
  });

  return sendTransactionalEmail({
    to: opts.to,
    subject: "Invoice request approved",
    html,
  });
}

/** Tell the rep their invoice request was rejected. */
export async function sendInvoiceRejectedEmail(opts: {
  to: string;
  businessName: string;
  packageName: string | null;
  amount: number;
  reason?: string | null;
}): Promise<SendResult> {
  const paragraphs = [
    "Your deal was reviewed and could not be approved at this time.",
    `Business: ${opts.businessName}`,
    `Package: ${opts.packageName || "—"}`,
    `Amount: ${formatCurrency(opts.amount)}`,
    "Status: Rejected",
  ];
  if (opts.reason) paragraphs.push(`Reason: ${opts.reason}`);
  paragraphs.push("Please review the deal details or contact the team.");

  const html = renderEmail({
    preheader: `Your deal "${opts.businessName}" was rejected.`,
    heading: "Your invoice request was rejected",
    paragraphs,
    cta: { label: "View your deals", url: `${APP_URL}/rep/deals` },
  });

  return sendTransactionalEmail({
    to: opts.to,
    subject: "Invoice request rejected",
    html,
  });
}
