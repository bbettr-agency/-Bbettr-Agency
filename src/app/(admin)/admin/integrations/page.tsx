import type { Metadata } from "next";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { isPlannerEnabled } from "@/lib/flags";
import { getConnectionStatus } from "@/lib/quickbooks";
import { getGoogleConnectionStatus } from "@/lib/google";
import { getPayfastDebugInfo } from "@/lib/payfast";
import { PageHeader } from "@/components/ui/page-header";
import {
  IntegrationCard,
  type IntegrationCardView,
} from "@/components/admin/integration-card";
import {
  quickbooksView,
  googleView,
  payfastView,
} from "./providers";

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
    isPlannerEnabled() ? getGoogleConnectionStatus() : Promise.resolve(null),
  ]);
  const payfast = getPayfastDebugInfo();
  const banner = resolveBanner(params);

  // The page renders provider DEFINITIONS — no provider-specific logic here.
  const providers: IntegrationCardView[] = [
    quickbooksView(qbo),
    google ? googleView(google) : null,
    payfastView(payfast),
  ].filter((v): v is IntegrationCardView => v !== null);

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

      {providers.map((view) => (
        <IntegrationCard key={view.title} {...view} />
      ))}
    </div>
  );
}
