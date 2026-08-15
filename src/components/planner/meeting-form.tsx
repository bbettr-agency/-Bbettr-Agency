"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Plus, X, Check, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea, Select, Label, FieldHelp } from "@/components/ui/input";
import {
  createMeetingAction,
  updateMeetingAction,
} from "@/lib/planner/meetings/actions";
import type { MeetingInput } from "@/lib/planner/meetings/types";

const COMMON_ZONES = [
  "Africa/Johannesburg",
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Australia/Sydney",
];

/** UTC ISO instant → a `datetime-local` wall-clock string in `tz`. */
function isoToLocalInput(iso: string, tz: string): string {
  const s = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
  return s.replace(" ", "T"); // "2026-08-01 09:00" → "2026-08-01T09:00"
}

const IDEM_KEY = "planner:new-meeting-idem";

/**
 * A stable idempotency key for creating one meeting. Persisted in sessionStorage
 * so a browser refresh, network retry or double-click reuses the SAME key (the
 * server action then dedupes) — cleared on a successful create.
 */
function getIdempotencyKey(): string {
  try {
    const existing = sessionStorage.getItem(IDEM_KEY);
    if (existing) return existing;
    const k = crypto.randomUUID();
    sessionStorage.setItem(IDEM_KEY, k);
    return k;
  } catch {
    return crypto.randomUUID();
  }
}
function clearIdempotencyKey() {
  try {
    sessionStorage.removeItem(IDEM_KEY);
  } catch {
    /* ignore */
  }
}

/** A `datetime-local` wall-clock string interpreted in `tz` → UTC ISO instant. */
function localInputToIso(local: string, tz: string): string {
  if (!local) return "";
  const asUTC = Date.parse(`${local}:00Z`);
  const tzT = Date.parse(new Date(asUTC).toLocaleString("en-US", { timeZone: tz }));
  const utcT = Date.parse(new Date(asUTC).toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(asUTC - (tzT - utcT)).toISOString();
}

export interface MeetingFormInitial {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  hasMeet: boolean;
  attendees: { email: string; displayName: string | null }[];
}

export function MeetingForm({ initial }: { initial?: MeetingFormInitial }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // On a successful CREATE we show an honest outcome (incl. confirmation-email
  // status) instead of navigating away immediately.
  const [created, setCreated] = useState<{ emailSent?: boolean; emailWarning?: string } | null>(null);

  const tz0 = initial?.timeZone ?? "Africa/Johannesburg";
  const [timeZone, setTimeZone] = useState(tz0);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [startLocal, setStartLocal] = useState(
    initial ? isoToLocalInput(initial.startsAt, tz0) : ""
  );
  const [endLocal, setEndLocal] = useState(
    initial ? isoToLocalInput(initial.endsAt, tz0) : ""
  );
  const [hasMeet, setHasMeet] = useState(initial?.hasMeet ?? false);
  const [attendees, setAttendees] = useState<
    { email: string; displayName: string }[]
  >(
    initial?.attendees.map((a) => ({
      email: a.email,
      displayName: a.displayName ?? "",
    })) ?? []
  );

  const zones = COMMON_ZONES.includes(tz0) ? COMMON_ZONES : [tz0, ...COMMON_ZONES];

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const input: MeetingInput = {
      title,
      description: description || null,
      startsAt: localInputToIso(startLocal, timeZone),
      endsAt: localInputToIso(endLocal, timeZone),
      timeZone,
      hasMeet,
      attendees: attendees
        .filter((a) => a.email.trim())
        .map((a) => ({ email: a.email, displayName: a.displayName || null })),
    };
    startTransition(async () => {
      const res = initial
        ? await updateMeetingAction(initial.id, input)
        : await createMeetingAction(input, getIdempotencyKey());
      if (res.error) {
        setError(res.error);
      } else if (initial) {
        router.push("/admin/planner/meetings");
      } else {
        clearIdempotencyKey();
        setCreated({ emailSent: res.emailSent, emailWarning: res.emailWarning });
      }
    });
  }

  if (created) {
    return (
      <Card>
        <CardContent className="space-y-4 py-8">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <CheckCircle className="h-5 w-5 text-emerald-600" /> Meeting scheduled
          </div>
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-center gap-2 text-ink-600">
              <Check className="h-4 w-4 shrink-0 text-emerald-600" /> Added to the Portal and calendar projection.
            </li>
            {created.emailWarning ? (
              <li className="flex items-start gap-2 text-amber-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {created.emailWarning}
              </li>
            ) : created.emailSent ? (
              <li className="flex items-center gap-2 text-ink-600">
                <Check className="h-4 w-4 shrink-0 text-emerald-600" /> Confirmation email sent to attendees.
              </li>
            ) : (
              <li className="text-ink-500">No attendees to email.</li>
            )}
          </ul>
          <Button type="button" onClick={() => router.push("/admin/planner/meetings")}>
            View meetings
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={submit} className="space-y-5">
          <div>
            <Label htmlFor="title" required>
              Title
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Client kickoff"
              required
            />
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Agenda, notes…"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="start" required>
                Starts
              </Label>
              <Input
                id="start"
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="end" required>
                Ends
              </Label>
              <Input
                id="end"
                type="datetime-local"
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <Label htmlFor="tz" required>
              Time zone
            </Label>
            <Select id="tz" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
            <FieldHelp>Times above are entered in this zone.</FieldHelp>
          </div>

          <label className="flex items-center gap-2.5 text-sm font-medium text-ink-700">
            <input
              type="checkbox"
              checked={hasMeet}
              onChange={(e) => setHasMeet(e.target.checked)}
              className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
            />
            Add a Google Meet link
          </label>

          <div>
            <Label>Attendees</Label>
            <div className="space-y-2">
              {attendees.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    type="email"
                    value={a.email}
                    placeholder="email@example.com"
                    onChange={(e) => {
                      const next = [...attendees];
                      next[i] = { ...next[i], email: e.target.value };
                      setAttendees(next);
                    }}
                  />
                  <Input
                    value={a.displayName}
                    placeholder="Name (optional)"
                    onChange={(e) => {
                      const next = [...attendees];
                      next[i] = { ...next[i], displayName: e.target.value };
                      setAttendees(next);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setAttendees(attendees.filter((_, j) => j !== i))}
                    className="rounded-lg p-2 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
                    aria-label="Remove attendee"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAttendees([...attendees, { email: "", displayName: "" }])}
              >
                <Plus className="h-4 w-4" /> Add attendee
              </Button>
            </div>
          </div>

          {error && (
            <p className="flex items-center gap-1.5 text-sm text-red-600">
              <AlertCircle className="h-4 w-4" /> {error}
            </p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" loading={pending}>
              {initial ? "Save changes" : "Create meeting"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push("/admin/planner/meetings")}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
