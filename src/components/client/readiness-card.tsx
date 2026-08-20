"use client";

import { useState } from "react";
import { PackageCheck, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReadinessChecklist } from "@/components/shared/readiness-checklist";
import type { Readiness } from "@/lib/readiness";
import { readinessSummary } from "./readiness-summary";

/**
 * Client Home "What we still need from you" — progressive (Slice 2C).
 *
 * Underlying readiness is unchanged; this only scales the footprint to how much
 * is outstanding: a full checklist while lots is missing, a one-line summary
 * (with expandable detail) when only a few remain, a compact success line when
 * everything is in, and nothing at all once the admin has received the assets.
 */
export function ReadinessCard({
  readiness,
  assetsReceived,
}: {
  readiness: Readiness;
  assetsReceived: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { mode, pending } = readinessSummary({ ...readiness, assetsReceived });

  if (mode === "hidden") return null;

  if (mode === "complete") {
    return (
      <Card className="border-emerald-200">
        <CardContent className="flex items-center gap-2 p-5 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Everything we need has been received — your team is reviewing it now.
        </CardContent>
      </Card>
    );
  }

  if (mode === "compact") {
    return (
      <Card className="border-brand-200">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <PackageCheck className="h-4.5 w-4.5 shrink-0 text-brand-500" />
              <p className="text-sm font-semibold text-ink-900">
                {pending} {pending === 1 ? "thing" : "things"} still needed from you
              </p>
            </div>
            <button
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              {open ? (
                <>
                  Hide <ChevronUp className="h-4 w-4" />
                </>
              ) : (
                <>
                  View details <ChevronDown className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
          {open && (
            <div className="mt-4">
              <ReadinessChecklist readiness={readiness} />
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // mode === "full"
  return (
    <Card className="border-brand-200">
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <PackageCheck className="h-4.5 w-4.5 text-brand-500" />
          <CardTitle>What we still need from you</CardTitle>
        </div>
        <Badge tone="warning" dot>
          {readiness.totalDone}/{readiness.totalItems} received
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-ink-500">
          Please provide the items marked <strong>Pending</strong> so we can
          begin. You can add them from your onboarding forms and files.
        </p>
        <ReadinessChecklist readiness={readiness} />
      </CardContent>
    </Card>
  );
}
