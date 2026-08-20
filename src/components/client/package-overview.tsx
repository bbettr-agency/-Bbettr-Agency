"use client";

import { useState } from "react";
import {
  Check,
  Sparkles,
  TrendingUp,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getService } from "@/lib/services";
import { splitPackages } from "@/lib/deliverables";
import type { ServiceType } from "@/lib/database.types";

/**
 * Premium "what you get" showcase (Slice 2C). Source of truth is the client's
 * actual purchased services. By default it's a compact "Your Services" summary —
 * the service names as chips — with the full per-service deliverables revealed
 * on demand, so it stops occupying a large static block on Home. Services the
 * client hasn't bought appear separately as Growth Opportunities. Presentation
 * only.
 */
export function PackageOverview({
  purchased,
  statuses,
}: {
  purchased: ServiceType[];
  /** Friendly resolved operational-state label per service (Slice 2E). */
  statuses?: Partial<Record<ServiceType, string>>;
}) {
  const { active, growth } = splitPackages(purchased);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4.5 w-4.5 text-brand-500" />
            <CardTitle>Your Services</CardTitle>
          </div>
          {active.length > 0 && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="flex shrink-0 items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              {open ? (
                <>
                  Hide <ChevronUp className="h-4 w-4" />
                </>
              ) : (
                <>
                  View what’s included <ChevronDown className="h-4 w-4" />
                </>
              )}
            </button>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {active.length > 0 ? (
            <>
              {/* Compact summary — always visible. */}
              <div className="flex flex-wrap gap-2">
                {active.map((svc) => {
                  const Icon = getService(svc.service).icon;
                  const status = statuses?.[svc.service];
                  return (
                    <span
                      key={svc.service}
                      className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-ink-50 px-3 py-1 text-sm font-medium text-ink-700"
                    >
                      <Icon className="h-4 w-4 text-brand-500" />
                      {svc.name}
                      {status && (
                        <span className="font-normal text-ink-400">— {status}</span>
                      )}
                    </span>
                  );
                })}
              </div>

              {/* Full deliverables — revealed on demand. */}
              {open &&
                active.map((svc) => {
                  const Icon = getService(svc.service).icon;
                  return (
                    <div key={svc.service}>
                      <div className="mb-3 flex items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                          <Icon className="h-4 w-4" />
                        </span>
                        <h3 className="text-sm font-semibold text-ink-900">
                          {svc.name}
                        </h3>
                      </div>
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {svc.deliverables.map((d) => (
                          <li
                            key={d}
                            className="flex items-center gap-2 text-sm text-ink-700"
                          >
                            <Check
                              className="h-4 w-4 shrink-0 text-emerald-500"
                              strokeWidth={3}
                            />
                            {d}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
            </>
          ) : (
            <p className="py-6 text-center text-sm text-ink-400">
              Your services will appear here once your package is set up.
            </p>
          )}
        </CardContent>
      </Card>

      {growth.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <TrendingUp className="h-4.5 w-4.5 text-brand-500" />
            <CardTitle>Growth Opportunities</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-ink-500">
              Ready to grow further? Here’s how we can help — just ask your
              Success Manager.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {growth.map((svc) => {
                const def = getService(svc.service);
                const Icon = def.icon;
                return (
                  <div
                    key={svc.service}
                    className="rounded-xl border border-dashed border-ink-200 bg-ink-50/40 p-4"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-ink-400 ring-1 ring-ink-100">
                        <Icon className="h-4 w-4" />
                      </span>
                      <h3 className="text-sm font-semibold text-ink-500">
                        {svc.name}
                      </h3>
                    </div>
                    <p className="mt-2 text-xs text-ink-400">{def.tagline}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
