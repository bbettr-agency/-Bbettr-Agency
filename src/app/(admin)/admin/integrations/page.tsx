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
            When you approve an invoice request, the deal is automatically
            invoiced in QuickBooks: the customer is created (or reused) and an
            invoice is raised in your company&rsquo;s currency. The invoice
            number is recorded against the request.
          </p>

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
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-ink-50 px-3 py-2">
      <span className="text-ink-500">{label}</span>
      <span className="truncate font-medium text-ink-900">{value}</span>
    </div>
  );
}
