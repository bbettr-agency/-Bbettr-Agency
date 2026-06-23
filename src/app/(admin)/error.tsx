"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Recovery boundary for the admin area. Catches errors thrown while rendering
 * an admin page and offers a retry instead of a broken screen.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
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
          This page failed to load. Retry, or head back to the overview.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button onClick={reset}>
            <RotateCw className="h-4 w-4" /> Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin">Back to overview</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
