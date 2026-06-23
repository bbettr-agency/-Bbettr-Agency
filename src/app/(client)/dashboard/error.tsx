"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Friendly recovery boundary for the client dashboard. Catches errors thrown
 * while rendering a dashboard page (e.g. a failed query) and offers a retry
 * instead of a broken screen. `reset()` re-renders the segment.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaces in server/client logs for debugging without exposing details.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="max-w-md rounded-2xl border border-ink-100 bg-white p-8 text-center shadow-card">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
          <AlertTriangle className="h-6 w-6" />
        </span>
        <h1 className="font-display text-lg font-bold text-ink-900">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          We couldn&apos;t load this page just now. Please try again — if it keeps
          happening, your account manager can help.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button onClick={reset}>
            <RotateCw className="h-4 w-4" /> Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
