"use client";

/**
 * Admin Services manager for a client (Slice 2E).
 *
 * PRIMARY line per service is its OPERATIONAL state:
 *   • Website — DERIVED (roadmap + website URLs), read-only ("Live" / "In
 *     Development" / "Not Started"); never an editable control.
 *   • Google Ads / Meta Ads / SEO — the stored client_services.operational_status,
 *     editable via a small dropdown. NULL resolves conservatively (never
 *     active/paused) and onboarding approval never implies Active.
 * Onboarding state is kept as SECONDARY context. Add Service (additive
 * activation only) and View Onboarding are preserved. No destructive controls.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import {
  addClientServiceAction,
  setServiceOperationalStatusAction,
} from "@/app/(admin)/admin/actions";
import { deriveServiceStateRows, type ServiceStateRow } from "@/lib/client-service-state";
import {
  resolveServiceOperational,
  adminOperationalLabel,
  isOperationalEditable,
  ADS_SEO_EDITABLE_OPTIONS,
  type OperationalStatus,
  type WebsiteSignals,
} from "@/lib/service-operational-state";
import type { ClientService, ServiceType, OnboardingStatus } from "@/lib/database.types";

const OP_TONE: Record<OperationalStatus, "neutral" | "warning" | "info" | "brand" | "success"> = {
  not_started: "neutral",
  setup: "warning",
  in_progress: "info",
  active: "success",
  paused: "neutral",
};

const ONBOARDING_SHORT: Record<OnboardingStatus, string> = {
  not_started: "Onboarding not started",
  in_progress: "Onboarding in progress",
  submitted: "Onboarding submitted",
  approved: "Onboarding complete",
};

export function ClientServicesManager({
  clientId,
  clientName,
  services,
  websiteSignals,
  onboardingServices,
  onViewOnboarding,
}: {
  clientId: string;
  clientName: string;
  services: ClientService[];
  /** Derivation signals for the (read-only) Website operational state. */
  websiteSignals: WebsiteSignals;
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
  const byService = new Map(services.map((s) => [s.service, s]));
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
      {rows.map((row) => {
        if (row.state === "not_added") {
          return (
            <div
              key={row.service}
              className="flex items-center justify-between gap-2 rounded-lg border border-ink-100 px-2.5 py-2"
            >
              <p className="truncate text-sm font-medium text-ink-500">{row.name}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setError(null);
                  setConfirming(row);
                }}
                className="shrink-0"
              >
                Add Service
              </Button>
            </div>
          );
        }

        const stored = byService.get(row.service);
        const operational = resolveServiceOperational({
          service: row.service,
          operationalStatus: stored?.operational_status ?? null,
          onboardingStatus: row.onboardingStatus,
          website: row.service === "website" ? websiteSignals : undefined,
        });

        return (
          <div
            key={row.service}
            className="flex items-center justify-between gap-3 rounded-lg border border-ink-100 px-2.5 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink-800">{row.name}</p>
              {row.onboardingStatus && (
                <p className="mt-0.5 truncate text-xs text-ink-400">
                  {ONBOARDING_SHORT[row.onboardingStatus]}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isOperationalEditable(row.service) ? (
                <OperationalControl
                  clientId={clientId}
                  service={row.service}
                  value={operational}
                />
              ) : (
                <Badge tone={OP_TONE[operational]} dot>
                  {adminOperationalLabel(row.service, operational)}
                </Badge>
              )}
              {hasOnboarding.has(row.service) && onViewOnboarding && (
                <Button size="sm" variant="ghost" onClick={onViewOnboarding} className="shrink-0">
                  Onboarding
                </Button>
              )}
            </div>
          </div>
        );
      })}

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

/** Editable operational-status dropdown for ads/SEO. Shows the current resolved
 *  state; picking a value stores it explicitly (NULL → chosen value). */
function OperationalControl({
  clientId,
  service,
  value,
}: {
  clientId: string;
  service: ServiceType;
  value: OperationalStatus;
}) {
  const [current, setCurrent] = useState<OperationalStatus>(value);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(next: OperationalStatus) {
    const prev = current;
    setCurrent(next);
    setError(null);
    startTransition(async () => {
      const res = await setServiceOperationalStatusAction(clientId, service, next);
      if (res.error) {
        setCurrent(prev);
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end">
      <select
        aria-label={`Operational status`}
        value={current}
        disabled={pending}
        onChange={(e) => change(e.target.value as OperationalStatus)}
        className="rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-sm font-medium text-ink-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:opacity-60"
      >
        {ADS_SEO_EDITABLE_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {adminOperationalLabel(service, o)}
          </option>
        ))}
      </select>
      {error && <span className="mt-0.5 text-[11px] text-rose-600">{error}</span>}
    </div>
  );
}
