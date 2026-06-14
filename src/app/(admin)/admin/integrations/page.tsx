import type { Metadata } from "next";
import { format } from "date-fns";
import {
  Plug,
  CheckCircle2,
  AlertCircle,
  Link2,
} from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getConnectionStatus } from "@/lib/quickbooks";
import { getPayfastDebugInfo } from "@/lib/payfast";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuickbooksDisconnect } from "@/components/admin/quickbooks-disconnect";

export const metadata: Metadata = { title: "Integrations" };

/** Banner copy for the ?qbo= status returned by the OAuth flow. */
const STATUS_MESSAGES: Record<string, { ok: boolean; msg: string }> = {
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
};

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ qbo?: string }>;
}) {
  await requireAdmin();
  const [{ qbo }, status] = await Promise.all([
    searchParams,
    getConnectionStatus(),
  ]);
  const payfast = getPayfastDebugInfo();

  const banner = qbo ? STATUS_MESSAGES[qbo] : null;

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

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Plug className="h-4.5 w-4.5 text-brand-500" />
            <CardTitle>QuickBooks Online</CardTitle>
          </div>
          {status.connected ? (
            <Badge tone="success" dot>
              Connected
            </Badge>
          ) : (
            <Badge tone="neutral" dot>
              Not connected
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-ink-600">
            When you approve an invoice request, the deal is invoiced in
            QuickBooks: the customer is created (or reused), an invoice is raised
            in your company&rsquo;s currency, and QuickBooks emails it to the
            client. The verified invoice number is recorded against the request.
          </p>

          {status.connected && status.environment === "sandbox" && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Connected to a QuickBooks <strong>sandbox</strong> company (realm{" "}
                <code className="font-mono">{status.realmId}</code>). Invoices,
                customers and numbers live in the sandbox — they will{" "}
                <strong>not</strong> appear in your live QuickBooks company. Switch{" "}
                <code className="font-mono">QBO_ENVIRONMENT</code> to{" "}
                <code className="font-mono">production</code> and reconnect when
                you&rsquo;re ready to invoice for real.
              </span>
            </div>
          )}

          {!status.configured && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                QuickBooks isn&rsquo;t configured on the server yet. Add the{" "}
                <code className="font-mono">QBO_*</code> environment variables in
                Vercel, then connect.
              </span>
            </div>
          )}

          {status.connected ? (
            <div className="space-y-3">
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <Row label="Environment" value={status.environment ?? "—"} />
                <Row label="Realm (Company ID)" value={status.realmId ?? "—"} />
                {status.companyName && (
                  <Row label="Company" value={status.companyName} />
                )}
                {status.connectedAt && (
                  <Row
                    label="Connected"
                    value={format(new Date(status.connectedAt), "d MMM yyyy, HH:mm")}
                  />
                )}
              </div>
              <div className="flex items-center justify-between gap-3 pt-1">
                <Button variant="outline" size="sm" asChild>
                  <a href="/api/quickbooks/connect">
                    <Link2 className="h-4 w-4" /> Reconnect
                  </a>
                </Button>
                <QuickbooksDisconnect />
              </div>
            </div>
          ) : (
            <div>
              <Button asChild disabled={!status.configured}>
                <a href="/api/quickbooks/connect">
                  <Link2 className="h-4 w-4" /> Connect QuickBooks
                </a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Plug className="h-4.5 w-4.5 text-brand-500" />
            <CardTitle>PayFast (international payments)</CardTitle>
          </div>
          <Badge tone={payfast.environment === "live" ? "success" : "neutral"} dot>
            {payfast.environment === "live" ? "Live" : "Sandbox"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-ink-600">
            International deals get a PayFast payment link once invoiced. South
            African clients pay by EFT and never get a link. Set{" "}
            <code className="font-mono">PAYFAST_ENVIRONMENT</code> to{" "}
            <code className="font-mono">live</code> (or{" "}
            <code className="font-mono">production</code>) in Vercel to use the
            real checkout. Diagnostics below never expose the merchant key or
            passphrase.
          </p>

          {!payfast.configured && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                PayFast isn&rsquo;t fully configured — set the{" "}
                <code className="font-mono">PAYFAST_*</code> environment variables
                in Vercel.
              </span>
            </div>
          )}

          {payfast.configured && payfast.environment === "sandbox" && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
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
            </div>
          )}

          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <Row
              label="PAYFAST_ENVIRONMENT (raw)"
              value={payfast.rawEnvValue ? payfast.rawEnvValue : "(unset)"}
            />
            <Row label="Resolved environment" value={payfast.environment} />
            <Row label="Active process URL" value={payfast.processUrl} wide />
            <Row label="Merchant ID" value={payfast.merchantId ?? "—"} />
            <Row label="App URL" value={payfast.appUrl ?? "—"} />
            <Row
              label="Passphrase set"
              value={payfast.passphraseSet ? "Yes" : "No"}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div
      className={
        "flex items-center justify-between gap-3 rounded-lg bg-ink-50 px-3 py-2 " +
        (wide ? "sm:col-span-2" : "")
      }
    >
      <span className="shrink-0 text-ink-500">{label}</span>
      <span className="truncate font-medium text-ink-900">{value}</span>
    </div>
  );
}
