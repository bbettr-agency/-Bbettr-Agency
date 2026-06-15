"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Eye, EyeOff } from "lucide-react";
import { format } from "date-fns";
import {
  addActivityEventAction,
  deleteActivityEventAction,
} from "@/app/(admin)/admin/actions";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface ActivityRow {
  id: string;
  type: string;
  title: string;
  description: string | null;
  visibility: string;
  occurred_at: string;
  source: string;
}

/**
 * Admin manager for the client's activity timeline: add curated milestones
 * (client-visible or internal) and remove events. Auto-generated events (client
 * created, stage transitions) also appear here.
 */
export function ActivityManager({
  clientId,
  events,
}: {
  clientId: string;
  events: ActivityRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.set("client_id", clientId);
    startTransition(async () => {
      const res = await addActivityEventAction(formData);
      if (!res.error) form.reset();
    });
  }

  function remove(id: string) {
    setBusyId(id);
    startTransition(async () => {
      await deleteActivityEventAction(id, clientId);
      setBusyId(null);
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="space-y-2 rounded-xl border border-ink-100 p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input name="title" placeholder="Event title (e.g. Invoice Paid)" required />
          <Input name="occurred_at" type="date" className="sm:w-44" />
        </div>
        <Textarea name="description" placeholder="Optional detail…" rows={2} />
        <div className="flex items-center justify-between gap-2">
          <select
            name="visibility"
            defaultValue="client"
            className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
          >
            <option value="client">Client visible</option>
            <option value="internal">Internal only</option>
          </select>
          <Button type="submit" variant="outline" loading={pending}>
            <Plus className="h-4 w-4" /> Add event
          </Button>
        </div>
      </form>

      {events.length > 0 ? (
        <ul className="space-y-2">
          {events.map((ev) => (
            <li
              key={ev.id}
              className="flex items-start gap-3 rounded-xl border border-ink-100 p-3"
            >
              <span
                className="mt-0.5 shrink-0 text-ink-300"
                title={ev.visibility === "internal" ? "Internal only" : "Client visible"}
              >
                {ev.visibility === "internal" ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4 text-brand-500" />
                )}
              </span>
              <div className="flex-1">
                <p className="text-sm font-medium text-ink-900">{ev.title}</p>
                {ev.description && (
                  <p className="text-xs text-ink-500">{ev.description}</p>
                )}
                <p className="mt-0.5 text-xs text-ink-400">
                  {format(new Date(ev.occurred_at), "d MMM yyyy")} · {ev.source}
                </p>
              </div>
              <button
                onClick={() => remove(ev.id)}
                disabled={pending && busyId === ev.id}
                className="shrink-0 text-ink-300 transition-colors hover:text-rose-500"
                title="Delete event"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-400">No activity yet.</p>
      )}
    </div>
  );
}
