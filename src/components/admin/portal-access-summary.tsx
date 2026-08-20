"use client";

import { formatDistanceToNow } from "date-fns";
import { ChevronRight } from "lucide-react";
import { PortalAccessCard } from "@/components/admin/portal-access-card";
import type { PortalAccess } from "@/lib/admin-queries";

/**
 * Compact Portal Access presentation for the Command Centre (Slice 2A).
 *
 * The default state is a single glanceable line (status + last login); the full
 * PortalAccessCard — URL, email, copy credentials, copy instructions, reset
 * password, send welcome email, resend credentials — lives UNCHANGED behind a
 * "Manage" disclosure. Zero functionality is removed; the heavy card is simply
 * collapsed by default so it stops dominating the Command Centre.
 */
export function PortalAccessSummary({
  clientId,
  portalUrl,
  access,
}: {
  clientId: string;
  portalUrl: string;
  access: PortalAccess;
}) {
  const statusText = !access.hasLogin
    ? "No portal access"
    : access.lastSignInAt
      ? `Portal active · Last login ${formatDistanceToNow(new Date(access.lastSignInAt), { addSuffix: true })}`
      : "Portal active · Never logged in";

  return (
    <details className="group rounded-xl border border-ink-100 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span
          className={
            access.hasLogin
              ? "h-2 w-2 shrink-0 rounded-full bg-emerald-500"
              : "h-2 w-2 shrink-0 rounded-full bg-ink-300"
          }
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-700">
          {statusText}
        </span>
        <span className="flex items-center gap-1 text-sm font-medium text-brand-600">
          Manage
          <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
        </span>
      </summary>
      <div className="border-t border-ink-100 p-4">
        <PortalAccessCard clientId={clientId} portalUrl={portalUrl} access={access} />
      </div>
    </details>
  );
}
