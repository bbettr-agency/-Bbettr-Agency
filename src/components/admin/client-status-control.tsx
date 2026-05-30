"use client";

import { useTransition } from "react";
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

  return (
    <Select
      defaultValue={status}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value as ClientStatus;
        startTransition(async () => {
          await updateClientStatusAction(clientId, next);
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
  );
}
