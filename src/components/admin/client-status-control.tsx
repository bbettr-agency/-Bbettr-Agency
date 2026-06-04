"use client";

import { useState, useRef, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { updateClientStatusAction } from "@/app/(admin)/admin/actions";
import { Select } from "@/components/ui/input";
import type { ClientStatus } from "@/lib/database.types";

const OPTIONS: { value: ClientStatus; label: string }[] = [
  { value: "lead", label: "Lead" },
  { value: "onboarding", label: "Onboarding" },
  { value: "in_progress", label: "In Progress" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
];

export function ClientStatusControl({
  clientId,
  status,
}: {
  clientId: string;
  status: ClientStatus;
}) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<ClientStatus>(status);
  const [error, setError] = useState<string | null>(null);
  const previous = useRef<ClientStatus>(status);

  return (
    <div className="space-y-1.5">
      <Select
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as ClientStatus;
          const prior = previous.current;
          setValue(next);
          setError(null);
          startTransition(async () => {
            const res = await updateClientStatusAction(clientId, next);
            if (res.error) {
              // Revert the dropdown if the change was rejected (e.g. the
              // Completed guard) and surface why.
              setValue(prior);
              setError(res.error);
            } else {
              previous.current = next;
            }
          });
        }}
        className="w-44"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {error && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
