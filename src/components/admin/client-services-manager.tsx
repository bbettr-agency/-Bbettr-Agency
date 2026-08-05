"use client";

/**
 * Admin Services manager for a client (additive activation only — no removal).
 *
 * Shows every supported service from the bounded catalogue with its current state
 * (Not Added / Active · Onboarding …) derived purely from the client's
 * `client_services` rows. "Add Service" opens a confirmation modal and calls the
 * admin-only `addClientServiceAction`, then refreshes via the established pattern.
 * "View Onboarding" appears only when a real onboarding submission exists (jumps
 * to the on-page Onboarding section). No destructive controls exist here.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { addClientServiceAction } from "@/app/(admin)/admin/actions";
import { deriveServiceStateRows, SERVICE_STATE_LABEL, type ServiceStateRow, type ServiceUiState } from "@/lib/client-service-state";
import type { ClientService, ServiceType } from "@/lib/database.types";

const TONE: Record<ServiceUiState, "neutral" | "warning" | "info" | "brand" | "success"> = {
  not_added: "neutral",
  onboarding_required: "warning",
  onboarding_in_progress: "info",
  onboarding_submitted: "brand",
  onboarding_completed: "success",
};

export function ClientServicesManager({
  clientId,
  clientName,
  services,
  onboardingServices,
  onViewOnboarding,
}: {
  clientId: string;
  clientName: string;
  services: ClientService[];
  /** Services that have a real onboarding submission (drives "View Onboarding"). */
  onboardingServices: ServiceType[];
  /** Jump to the on-page Onboarding section, when a real destination exists. */
  onViewOnboarding?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<ServiceStateRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = deriveServiceStateRows(services);
  const hasOnboarding = new Set(onboardingServices);

  function confirmAdd() {
    if (!confirming) return;
    const service = confirming.service;
    setError(null);
    startTransition(async () => {
      const res = await addClientServiceAction(clientId, service);
      if (res.error) {
        setError(res.error);
        return;
      }
      setConfirming(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.service} className="flex items-center justify-between gap-2 rounded-lg border border-ink-100 px-2.5 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink-800">{row.name}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
              <Badge tone={TONE[row.state]} dot>
                {SERVICE_STATE_LABEL[row.state]}
              </Badge>
              {row.addedAt ? <span>Added {format(new Date(row.addedAt), "d MMM yyyy")}</span> : null}
            </p>
          </div>
          {row.state === "not_added" ? (
            <Button size="sm" variant="outline" onClick={() => { setError(null); setConfirming(row); }} className="shrink-0">
              Add Service
            </Button>
          ) : hasOnboarding.has(row.service) && onViewOnboarding ? (
            <Button size="sm" variant="ghost" onClick={onViewOnboarding} className="shrink-0">
              View Onboarding
            </Button>
          ) : null}
        </div>
      ))}

      <Modal
        open={confirming != null}
        onClose={() => (pending ? undefined : setConfirming(null))}
        title={confirming ? `Add ${confirming.name} to ${clientName}?` : undefined}
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-600">
            This will activate {confirming?.name} on the client&rsquo;s existing account and make the {confirming?.name} onboarding form available in their Client Portal.
          </p>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirming(null)} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={confirmAdd} loading={pending} disabled={pending}>
              Add Service
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
