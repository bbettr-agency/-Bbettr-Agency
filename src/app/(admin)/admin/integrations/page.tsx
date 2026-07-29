import type { Metadata } from "next";
import { format } from "date-fns";
import { CheckCircle2, AlertCircle, Link2 } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { PLANNER_ENABLED } from "@/lib/flags";
import { getConnectionStatus } from "@/lib/quickbooks";
import { getGoogleConnectionStatus } from "@/lib/google";
import { getPayfastDebugInfo } from "@/lib/payfast";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { QuickbooksDisconnect } from "@/components/admin/quickbooks-disconnect";
import { GoogleDisconnect } from "@/components/admin/google-disconnect";
import {
  IntegrationCard,
  IntegrationNotice,
} from "@/components/admin/integration-card";

export const metadata: Metadata = { title: "Integrations" };

type Banner = { ok: boolean; msg: string };

/** Status-banner copy per provider, keyed by the ?<provider>= redirect param. */
const STATUS_MESSAGES: Record<string, Record<string, Banner>> = {
  qbo: {
    connected: { ok: true, msg: "QuickBooks connected successfully." },
    denied: { ok: false, msg: "QuickBooks connection was cancelled." },
    error: {
      ok: false,
      msg: "Could not complete the QuickBooks connection. Please try again.",
    },
    not_configured: {
      ok: false,
      msg: "QuickBooks is not configured on the server (missing QBO_* environment variables).",
    },
  },
  google: {
    connected: { ok: true, msg: "Google Calendar connected successfully." },
    denied: { ok: false, msg: "Google connection was cancelled." },
    error: {
      ok: false,
      msg: "Could not complete the Google connection. Please try again.",
    },
    not_configured: {
      ok: false,
      msg: "Google is not configured on the server (missing GOOGLE_* environment variables).",
    },
    wrong_account: {
      ok: false,
      msg: "A different Google account was used. Connect with the shared agency account.",
    },
  },
};

function resolveBanner(params: {
  qbo?: string;
  google?: string;
}): Banner | null {
  if (params.qbo) return STATUS_MESSAGES.qbo[params.qbo] ?? null;
  if (params.google) return STATUS_MESSAGES.google[params.google] ?? null;
  return null;
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ qbo?: string; google?: string }>;
}) {
  await requireAdmin();
  const [params, qbo, google] = await Promise.all([
    searchParams,
    getConnectionStatus(),
    // Google is part of the internal Planner module; only read it when enabled.
    PLANNER_ENABLED ? getGoogleConnectionStatus() : Promise.resolve(null),
  ]);
  const payfast = getPayfastDebugInfo();
  const banner = resolveBanner(params);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Integrations"
        description="Connect Bbettr Agency to the tools you use. Invoicing is powered by QuickBooks Online."
      />

      {banner && (
        <div
          className={
            "flex items-center gap-2 rounded-xl border p-3 text-sm " +
            (banner.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800")
          }
        >
          {banner.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          {banner.msg}
        </div>
      )}

      {/* QuickBooks Online */}
      <IntegrationCard
        title="QuickBooks Online"
        badge={
          qbo.connected
            ? { label: "Connected", tone: "success" }
            : { label: "Not connected", tone: "neutral" }
        }
        description="When you approve an invoice request, the deal is invoiced in QuickBooks: the customer is created (or reused), an invoice is raised in your company's currency, and QuickBooks emails it to the client. The verified invoice number is recorded against the request."
        notices={
          <>
            {qbo.connected && qbo.environment === "sandbox" && (
              <IntegrationNotice>
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Connected to a QuickBooks <strong>sandbox</strong> company
                  (realm <code className="font-mono">{qbo.realmId}</code>).
                  Invoices, customers and numbers live in the sandbox — they will{" "}
                  <strong>not</strong> appear in your live QuickBooks company.
                  Switch <code className="font-mono">QBO_ENVIRONMENT</code> to{" "}
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
        }
        rows={
          qbo.connected
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
                        value: format(
                          new Date(qbo.connectedAt),
                          "d MMM yyyy, HH:mm"
                        ),
                      },
                    ]
                  : []),
              ]
            : undefined
        }
        actions={
          qbo.connected ? (
            <div className="flex items-center justify-between gap-3 pt-1">
              <Button variant="outline" size="sm" asChild>
                <a href="/api/quickbooks/connect">
                  <Link2 className="h-4 w-4" /> Reconnect
                </a>
              </Button>
              <QuickbooksDisconnect />
            </div>
          ) : (
            <Button asChild disabled={!qbo.configured}>
              <a href="/api/quickbooks/connect">
                <Link2 className="h-4 w-4" /> Connect QuickBooks
              </a>
            </Button>
          )
        }
      />

      {/* Google Calendar (internal Planner module; flag-gated) */}
      {google && (
        <IntegrationCard
          title="Google Calendar"
          badge={
            google.status === "connected" && google.connected
              ? { label: "Connected", tone: "success" }
              : google.status === "reconnect_required"
                ? { label: "Reconnect required", tone: "warning" }
                : { label: "Not connected", tone: "neutral" }
          }
          description="Connects the shared agency Google account so Bbettr OS can create calendar events and Google Meet links for meetings. Google is an optional integration — if it's disconnected or unavailable, the rest of the Portal is unaffected."
          notices={
            <>
              {!google.configured && (
                <IntegrationNotice>
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Google isn&rsquo;t configured on the server yet. Add the{" "}
                    <code className="font-mono">GOOGLE_*</code> environment
                    variables in Vercel, then connect.
                  </span>
                </IntegrationNotice>
              )}
              {google.status === "reconnect_required" && (
                <IntegrationNotice>
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Google access expired or was revoked. Reconnect to restore
                    calendar and Meet features. Nothing else in the Portal is
                    affected in the meantime.
                  </span>
                </IntegrationNotice>
              )}
            </>
          }
          rows={
            google.connected
              ? [
                  {
                    label: "Account",
                    value: google.googleAccountEmail ?? "—",
                  },
                  {
                    label: "Calendar",
                    value: google.googleCalendarId ?? "—",
                  },
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
              : undefined
          }
          actions={
            google.connected ? (
              <div className="flex items-center justify-between gap-3 pt-1">
                <Button variant="outline" size="sm" asChild>
                  <a href="/api/google/connect">
                    <Link2 className="h-4 w-4" /> Reconnect
                  </a>
                </Button>
                <GoogleDisconnect />
              </div>
            ) : (
              <Button asChild disabled={!google.configured}>
                <a href="/api/google/connect">
                  <Link2 className="h-4 w-4" />{" "}
                  {google.status === "reconnect_required"
                    ? "Reconnect Google"
                    : "Connect Google"}
                </a>
              </Button>
            )
          }
        />
      )}

      {/* PayFast (international payments) */}
      <IntegrationCard
        title="PayFast (international payments)"
        badge={
          payfast.environment === "live"
            ? { label: "Live", tone: "success" }
            : { label: "Sandbox", tone: "neutral" }
        }
        description="International deals get a PayFast payment link once invoiced. South African clients pay by EFT and never get a link. Set PAYFAST_ENVIRONMENT to live (or production) in Vercel to use the real checkout. Diagnostics below never expose the merchant key or passphrase."
        notices={
          <>
            {!payfast.configured && (
              <IntegrationNotice>
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  PayFast isn&rsquo;t fully configured — set the{" "}
                  <code className="font-mono">PAYFAST_*</code> environment
                  variables in Vercel.
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
        }
        rows={[
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
        ]}
      />
    </div>
  );
}
