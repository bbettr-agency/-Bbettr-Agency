"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { OnboardingStatusBadge } from "@/components/ui/status-badge";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { getService } from "@/lib/services";
import type { OnboardingState } from "@/app/(client)/dashboard/onboarding/actions";
import type {
  ServiceType,
  OnboardingStatus,
  OnboardingSubmission,
} from "@/lib/database.types";

interface OnboardingTabsProps {
  clientId: string;
  services: { service: ServiceType; onboarding_status: OnboardingStatus }[];
  submissions: OnboardingSubmission[];
}

export function OnboardingTabs({
  clientId,
  services,
  submissions,
}: OnboardingTabsProps) {
  const router = useRouter();
  const [active, setActive] = useState<ServiceType>(services[0]?.service);
  if (!active) return null;

  // After a successful submission: jump to the next incomplete service, or
  // return to the dashboard once everything is done. router.refresh() re-reads
  // the server data so the status badges and progress update with no manual
  // reload.
  function handleSubmitted(result: OnboardingState) {
    if (result.nextService && result.nextService !== active) {
      setActive(result.nextService);
      router.refresh();
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  }

  const def = getService(active);
  const submission = submissions.find((s) => s.service === active);
  const status =
    services.find((s) => s.service === active)?.onboarding_status ??
    "not_started";

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      {/* Service rail */}
      <div className="space-y-2">
        {services.map(({ service, onboarding_status }) => {
          const s = getService(service);
          const isActive = service === active;
          return (
            <button
              key={service}
              onClick={() => setActive(service)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all",
                isActive
                  ? "border-brand-300 bg-brand-50 shadow-sm"
                  : "border-ink-100 bg-white hover:border-ink-200"
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white",
                  s.accent
                )}
              >
                <s.icon className="h-4.5 w-4.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink-900">
                  {s.name}
                </span>
                <span className="mt-0.5 block">
                  <OnboardingStatusBadge status={onboarding_status} />
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Active form */}
      <Card>
        <CardContent className="p-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold text-ink-900">
                {def.name} Onboarding
              </h2>
              <p className="text-sm text-ink-500">{def.tagline}</p>
            </div>
            <OnboardingStatusBadge status={status} />
          </div>

          {status === "submitted" || status === "approved" ? (
            <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              You&apos;ve submitted this onboarding. You can still review your
              answers below — contact your account manager to make changes.
            </div>
          ) : null}

          <OnboardingForm
            key={active}
            clientId={clientId}
            service={def}
            initialData={(submission?.data as Record<string, unknown>) ?? {}}
            readOnly={status === "approved"}
            onSubmitted={handleSubmitted}
          />
        </CardContent>
      </Card>
    </div>
  );
}
