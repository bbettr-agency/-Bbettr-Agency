import Link from "next/link";
import { AlertTriangle, Settings } from "lucide-react";

/**
 * Prominent, actionable banner for Google Calendar connection problems, so a
 * disconnected / not-configured integration is impossible to miss instead of
 * looking like an ordinary "Not synced" meeting. Reads a whitelisted status only
 * (never the Google account email / tokens). Renders nothing when healthy.
 */
export function GoogleSyncBanner({
  configured,
  status,
}: {
  configured: boolean;
  status: "connected" | "reconnect_required" | "disconnected";
}) {
  if (configured && status === "connected") return null;

  const notConfigured = !configured;
  const message = notConfigured
    ? "Google Calendar isn't set up on the server yet — new meetings won't sync to Google Calendar or show a Join link."
    : "Google Calendar is disconnected — new meetings won't sync or get a Join link until you reconnect.";
  const cta = notConfigured ? "Set up Google" : "Reconnect Google";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2.5 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-600" />
        <span>{message}</span>
      </div>
      <Link
        href="/admin/integrations"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-amber-700"
      >
        <Settings className="h-4 w-4" /> {cta}
      </Link>
    </div>
  );
}
