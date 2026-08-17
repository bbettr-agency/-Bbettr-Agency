"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveMeetingOutcomeNotesAction } from "@/lib/planner/meetings/actions";

const MAX = 4000;

/**
 * Internal outcome/notes editor (0054). Admin-only, capped at 4000 chars in the
 * UI (also enforced server-side). Internal only — never emailed, never projected
 * to Google.
 */
export function MeetingOutcomeNotes({ id, initialNotes }: { id: string; initialNotes: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initialNotes ?? "");
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = value !== (initialNotes ?? "");
  const remaining = MAX - value.length;

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveMeetingOutcomeNotesAction(id, value);
      if (res.error) setError(res.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor="outcome-notes" className="text-sm font-semibold text-ink-800">
          Internal outcome / notes
        </label>
        <span className={`text-xs ${remaining < 0 ? "text-red-600" : "text-ink-400"}`}>{remaining} left</span>
      </div>
      <textarea
        id="outcome-notes"
        value={value}
        maxLength={MAX}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        rows={4}
        placeholder="Internal only — e.g. what was discussed, follow-ups, decisions. Never sent to attendees or Google."
        className="w-full resize-y rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
      />
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={!dirty || pending || value.length > MAX} loading={pending} onClick={save}>
          Save notes
        </Button>
        {saved && !dirty && (
          <span className="flex items-center gap-1 text-xs text-ink-500">
            <Check className="h-3.5 w-3.5 text-emerald-600" /> Saved
          </span>
        )}
        {error && (
          <span className="flex items-center gap-1 text-xs text-red-600">
            <AlertCircle className="h-3.5 w-3.5" /> {error}
          </span>
        )}
      </div>
      <p className="text-xs text-ink-400">Internal only — never emailed to attendees or sent to Google Calendar.</p>
    </div>
  );
}
