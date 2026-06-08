"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  PackageCheck,
  AlertTriangle,
  Bell,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ReadinessChecklist } from "@/components/shared/readiness-checklist";
import {
  markAssetsReceivedAction,
  sendAssetsReminderAction,
} from "@/app/(admin)/admin/actions";
import type { Readiness } from "@/lib/readiness";

export function AssetsReceivedControl({
  clientId,
  readiness,
  assetsReceived,
}: {
  clientId: string;
  readiness: Readiness;
  /** True once the "Assets Received" stage is already completed. */
  assetsReceived: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [postUpdate, setPostUpdate] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reminderSent, setReminderSent] = useState(false);

  function approve() {
    setError(null);
    startTransition(async () => {
      const res = await markAssetsReceivedAction(clientId, postUpdate);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function sendReminder() {
    setError(null);
    setReminderSent(false);
    startTransition(async () => {
      const res = await sendAssetsReminderAction(clientId);
      if (res.error) setError(res.error);
      else setReminderSent(true);
    });
  }

  if (assetsReceived) {
    return (
      <Card className="border-emerald-200">
        <CardContent className="flex items-center gap-3 p-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-900">
              Assets received — development underway
            </p>
            <p className="text-sm text-ink-500">
              You approved this client&apos;s assets and the project is in
              development.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <PackageCheck className="h-4.5 w-4.5 text-brand-500" />
          <CardTitle>Asset Readiness</CardTitle>
        </div>
        {readiness.hasItems &&
          (readiness.allReady ? (
            <Badge tone="success" dot>
              Looks ready
            </Badge>
          ) : (
            <Badge tone="warning" dot>
              {readiness.totalDone}/{readiness.totalItems} received
            </Badge>
          ))}
      </CardHeader>
      <CardContent className="space-y-4">
        {readiness.hasItems ? (
          <ReadinessChecklist readiness={readiness} />
        ) : (
          <p className="text-sm text-ink-500">
            This client&apos;s services don&apos;t require trackable assets. You
            can mark assets received once you&apos;ve confirmed access.
          </p>
        )}

        {!readiness.allReady && readiness.hasItems && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Some items are still pending. You can still proceed if you&apos;ve
              confirmed them another way.
            </span>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-ink-600">
          <input
            type="checkbox"
            checked={postUpdate}
            onChange={(e) => setPostUpdate(e.target.checked)}
            className="h-4 w-4 rounded border-ink-300 text-brand-500 focus:ring-brand-400"
          />
          Post an update letting the client know development has started
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={approve} loading={pending}>
            <PackageCheck className="h-4 w-4" /> Mark Assets Received
          </Button>
          <Button variant="outline" onClick={sendReminder} disabled={pending}>
            <Bell className="h-4 w-4" /> Send reminder
          </Button>
          {reminderSent && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> Reminder emailed
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
