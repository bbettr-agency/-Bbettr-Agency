import { AlertCircle, Link2 } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { QuickbooksDisconnect } from "@/components/admin/quickbooks-disconnect";
import { GoogleDisconnect } from "@/components/admin/google-disconnect";
import {
  IntegrationNotice,
  type IntegrationCardView,
} from "@/components/admin/integration-card";
import type { QboConnectionStatus } from "@/lib/quickbooks";
import type { GoogleConnectionStatus } from "@/lib/google";
import type { getPayfastDebugInfo } from "@/lib/payfast";

/**
 * Provider definitions for the Integrations page.
 *
 * Each provider is a builder `(status) => IntegrationCardView | null` conforming
 * to the shared contract in integration-card.tsx. All provider-specific copy,
 * badges, notices, rows and actions live here — the page is a pure renderer.
 * OAuth providers (QuickBooks, Google) share one `oauthCardView` shape so the
 * connect/reconnect/disconnect layout exists in exactly one place.
 */

type PayfastDebugInfo = ReturnType<typeof getPayfastDebugInfo>;

/** Shared card shape for any OAuth connect/reconnect/disconnect provider. */
function oauthCardView(opts: {
  title: string;
  description: string;
  connectPath: string;
  configured: boolean;
  connected: boolean;
  connectLabel: string;
  badge: IntegrationCardView["badge"];
  notices?: React.ReactNode;
  rows?: IntegrationCardView["rows"];
  disconnect: React.ReactNode;
}): IntegrationCardView {
  return {
    title: opts.title,
    badge: opts.badge,
    description: opts.description,
    notices: opts.notices,
    rows: opts.rows,
    actions: opts.connected ? (
      <div className="flex items-center justify-between gap-3 pt-1">
        <Button variant="outline" size="sm" asChild>
          <a href={opts.connectPath}>
            <Link2 className="h-4 w-4" /> Reconnect
          </a>
        </Button>
        {opts.disconnect}
      </div>
    ) : (
      <Button asChild disabled={!opts.configured}>
        <a href={opts.connectPath}>
          <Link2 className="h-4 w-4" /> {opts.connectLabel}
        </a>
      </Button>
    ),
  };
}

/** QuickBooks Online — invoicing. */
export function quickbooksView(qbo: QboConnectionStatus): IntegrationCardView {
  return oauthCardView({
    title: "QuickBooks Online",
    description:
      "When you approve an invoice request, the deal is invoiced in QuickBooks: the customer is created (or reused), an invoice is raised in your company's currency, and QuickBooks emails it to the client. The verified invoice number is recorded against the request.",
    connectPath: "/api/quickbooks/connect",
    configured: qbo.configured,
    connected: qbo.connected,
    connectLabel: "Connect QuickBooks",
    badge: qbo.connected
      ? { label: "Connected", tone: "success" }
      : { label: "Not connected", tone: "neutral" },
    notices: (
      <>
        {qbo.connected && qbo.environment === "sandbox" && (
          <IntegrationNotice>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Connected to a QuickBooks <strong>sandbox</strong> company (realm{" "}
              <code className="font-mono">{qbo.realmId}</code>). Invoices,
              customers and numbers live in the sandbox — they will{" "}
              <strong>not</strong> appear in your live QuickBooks company. Switch{" "}
              <code className="font-mono">QBO_ENVIRONMENT</code> to{" "}
              <code className="font-mono">production</code> and reconnect when
              you&rsquo;re ready to invoice for real.
            </span>
          </IntegrationNotice>
        )}
        {!qbo.configured && (
          <IntegrationNotice>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              QuickBooks isn&rsquo;t configured on the server yet. Add the{" "}
              <code className="font-mono">QBO_*</code> environment variables in
              Vercel, then connect.
            </span>
          </IntegrationNotice>
        )}
      </>
    ),
    rows: qbo.connected
      ? [
          { label: "Environment", value: qbo.environment ?? "—" },
          { label: "Realm (Company ID)", value: qbo.realmId ?? "—" },
          ...(qbo.companyName
            ? [{ label: "Company", value: qbo.companyName }]
            : []),
          ...(qbo.connectedAt
            ? [
                {
                  label: "Connected",
                  value: format(new Date(qbo.connectedAt), "d MMM yyyy, HH:mm"),
                },
              ]
            : []),
        ]
      : undefined,
    disconnect: <QuickbooksDisconnect />,
  });
}

/** Google Calendar — internal Planner module (Bbettr OS). */
export function googleView(google: GoogleConnectionStatus): IntegrationCardView {
  const connected = google.status === "connected" && google.connected;
  const reconnect = google.status === "reconnect_required";
  return oauthCardView({
    title: "Google Calendar",
    description:
      "Connects the shared agency Google account so Bbettr OS can create calendar events and Google Meet links for meetings. Google is an optional integration — if it's disconnected or unavailable, the rest of the Portal is unaffected.",
    connectPath: "/api/google/connect",
    configured: google.configured,
    connected,
    connectLabel: reconnect ? "Reconnect Google" : "Connect Google",
    badge: connected
      ? { label: "Connected", tone: "success" }
      : reconnect
        ? { label: "Reconnect required", tone: "warning" }
        : { label: "Not connected", tone: "neutral" },
    notices: (
      <>
        {!google.configured && (
          <IntegrationNotice>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Google isn&rsquo;t configured on the server yet. Add the{" "}
              <code className="font-mono">GOOGLE_*</code> environment variables in
              Vercel, then connect.
            </span>
          </IntegrationNotice>
        )}
        {reconnect && (
          <IntegrationNotice>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Google access expired or was revoked. Reconnect to restore calendar
              and Meet features. Nothing else in the Portal is affected in the
              meantime.
            </span>
          </IntegrationNotice>
        )}
      </>
    ),
    rows: connected
      ? [
          { label: "Account", value: google.googleAccountEmail ?? "—" },
          { label: "Calendar", value: google.googleCalendarId ?? "—" },
          ...(google.connectedAt
            ? [
                {
                  label: "Connected",
                  value: format(
                    new Date(google.connectedAt),
                    "d MMM yyyy, HH:mm"
                  ),
                },
              ]
            : []),
        ]
      : undefined,
    disconnect: <GoogleDisconnect />,
  });
}

/** PayFast — international payment links (diagnostics only, no OAuth). */
export function payfastView(payfast: PayfastDebugInfo): IntegrationCardView {
  return {
    title: "PayFast (international payments)",
    badge:
      payfast.environment === "live"
        ? { label: "Live", tone: "success" }
        : { label: "Sandbox", tone: "neutral" },
    description:
      "International deals get a PayFast payment link once invoiced. South African clients pay by EFT and never get a link. Set PAYFAST_ENVIRONMENT to live (or production) in Vercel to use the real checkout. Diagnostics below never expose the merchant key or passphrase.",
    notices: (
      <>
        {!payfast.configured && (
          <IntegrationNotice>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              PayFast isn&rsquo;t fully configured — set the{" "}
              <code className="font-mono">PAYFAST_*</code> environment variables
              in Vercel.
            </span>
          </IntegrationNotice>
        )}
        {payfast.configured && payfast.environment === "sandbox" && (
          <IntegrationNotice>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              PayFast is in <strong>sandbox</strong> — links go to{" "}
              <code className="font-mono">sandbox.payfast.co.za</code> and{" "}
              <strong>no real money moves</strong>. Your current{" "}
              <code className="font-mono">PAYFAST_ENVIRONMENT</code> value is{" "}
              <code className="font-mono">
                {payfast.rawEnvValue ? `"${payfast.rawEnvValue}"` : "(unset)"}
              </code>
              . Set it to <code className="font-mono">live</code> or{" "}
              <code className="font-mono">production</code> and redeploy.
            </span>
          </IntegrationNotice>
        )}
      </>
    ),
    rows: [
      {
        label: "PAYFAST_ENVIRONMENT (raw)",
        value: payfast.rawEnvValue ? payfast.rawEnvValue : "(unset)",
      },
      { label: "Resolved environment", value: payfast.environment },
      { label: "Active process URL", value: payfast.processUrl, wide: true },
      { label: "Merchant ID", value: payfast.merchantId ?? "—" },
      { label: "App URL", value: payfast.appUrl ?? "—" },
      { label: "Passphrase set", value: payfast.passphraseSet ? "Yes" : "No" },
      {
        label: "ITN auto-mark paid",
        value: payfast.itnEnabled ? "Enabled" : "Disabled (manual only)",
      },
    ],
  };
}
