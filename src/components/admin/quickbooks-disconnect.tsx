"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { disconnectQuickbooksAction } from "@/app/(admin)/admin/integrations/actions";

export function QuickbooksDisconnect() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function disconnect() {
    setError(null);
    startTransition(async () => {
      const res = await disconnectQuickbooksAction();
      if (res.error) setError(res.error);
      else {
        setConfirming(false);
        router.refresh();
      }
    });
  }

  if (!confirming) {
    return (
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        <Unplug className="h-4 w-4" /> Disconnect
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-600">Disconnect QuickBooks?</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button
          variant="danger"
          size="sm"
          loading={pending}
          onClick={disconnect}
        >
          Disconnect
        </Button>
      </div>
      {error && (
        <p className="flex items-center gap-1 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      )}
    </div>
  );
}
