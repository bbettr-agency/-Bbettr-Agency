"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import {
  setClientLaunchDateAction,
  assignSuccessManagerAction,
} from "@/app/(admin)/admin/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface TeamMemberOption {
  id: string;
  name: string;
  role: string | null;
  is_default: boolean;
}

/**
 * Admin controls for the client-experience surface: estimated launch date (shown
 * in the client's hero / next-step) and the assigned Success Manager.
 */
export function ProjectSettingsManager({
  clientId,
  estimatedLaunchDate,
  successManagerId,
  teamMembers,
}: {
  clientId: string;
  estimatedLaunchDate: string | null;
  successManagerId: string | null;
  teamMembers: TeamMemberOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(estimatedLaunchDate ?? "");
  const [saved, setSaved] = useState<string | null>(null);

  function flash(msg: string) {
    setSaved(msg);
    setTimeout(() => setSaved(null), 1800);
  }

  function saveDate() {
    startTransition(async () => {
      const res = await setClientLaunchDateAction(clientId, date || null);
      if (!res.error) flash("Launch date saved");
    });
  }

  function saveManager(value: string) {
    startTransition(async () => {
      const res = await assignSuccessManagerAction(clientId, value || null);
      if (!res.error) flash("Success manager updated");
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-ink-400">
          Estimated launch date
        </label>
        <div className="flex gap-2">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Button variant="outline" onClick={saveDate} loading={pending}>
            Save
          </Button>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-ink-400">
          Success Manager
        </label>
        <select
          value={successManagerId ?? ""}
          onChange={(e) => saveManager(e.target.value)}
          disabled={pending}
          className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        >
          <option value="">Default (agency)</option>
          {teamMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.role ? ` — ${m.role}` : ""}
              {m.is_default ? " (default)" : ""}
            </option>
          ))}
        </select>
      </div>

      {saved && (
        <p className="flex items-center gap-1 text-xs font-medium text-emerald-600">
          <Check className="h-3.5 w-3.5" /> {saved}
        </p>
      )}
    </div>
  );
}
