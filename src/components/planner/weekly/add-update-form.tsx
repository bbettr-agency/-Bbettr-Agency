"use client";

/**
 * "+ Add update" — logs off-Planner work to Weekly Updates without a fake task.
 * Collapsed to a button; opens an inline form (what / client optional / date).
 * The author + workspace are derived server-side by the action — this island
 * supplies only summary/client/date. `defaultDate` is server-provided (never
 * `new Date()` here) so SSR and hydration agree.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { addWeeklyUpdateAction } from "@/app/(admin)/admin/planner/weekly-updates/actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, FieldHelp } from "@/components/ui/input";

export function AddUpdateForm({ clients, defaultDate }: { clients: { id: string; name: string }[]; defaultDate: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [clientId, setClientId] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function reset() {
    setSummary("");
    setClientId("");
    setDate(defaultDate);
    setMessage(null);
  }

  async function submit() {
    if (submitting) return;
    if (summary.trim().length === 0) {
      setMessage("Enter what you did.");
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await addWeeklyUpdateAction({ summary, clientId: clientId || null, updateDate: date });
      if (res.ok) {
        reset();
        setOpen(false);
        router.refresh();
      } else {
        setMessage(res.error);
      }
    } catch {
      setMessage("Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Add update
      </Button>
    );
  }

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-sm">
      <div className="space-y-3">
        <div>
          <Label htmlFor="wu-summary">What did you do?</Label>
          <Input
            id="wu-summary"
            value={summary}
            maxLength={500}
            placeholder="e.g. Updated Cuisine Foods campaign targeting"
            onChange={(e) => {
              setSummary(e.target.value);
              if (message) setMessage(null);
            }}
          />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="sm:flex-1">
            <Label htmlFor="wu-client">Client (optional)</Label>
            <Select id="wu-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Internal / No client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:w-48">
            <Label htmlFor="wu-date">Date</Label>
            <Input id="wu-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        {message ? <FieldHelp className="text-red-600">{message}</FieldHelp> : null}
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={submit} disabled={submitting} loading={submitting} aria-busy={submitting || undefined}>
            Add update
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setOpen(false);
              reset();
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
