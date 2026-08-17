"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Clock, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmRescheduleAction } from "@/app/reschedule/[token]/actions";
import type { ConfirmResult } from "@/lib/planner/meetings/reschedule-service";

interface DaySlots {
  dateYmd: string;
  slots: { startsAt: string; endsAt: string }[];
}
interface PublicMeeting {
  title: string;
  currentStartsAt: string;
  currentEndsAt: string;
  timeZone: string;
}

function dayLabel(dateYmd: string): string {
  // Format the plain date at UTC noon so the weekday never drifts across zones.
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${dateYmd}T12:00:00Z`));
}
function timeLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
function fullWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

const MESSAGES: Record<Exclude<ConfirmResult["status"], "ok">, string> = {
  slot_taken: "That time is no longer available. Please choose another time.",
  slot_invalid: "That time is no longer available. Please choose another time.",
  unavailable: "Availability is temporarily unavailable. Please try again shortly.",
  invalid: "This rescheduling link is no longer valid.",
  error: "Something went wrong. Please try again.",
};

export function RescheduleFlow({
  token,
  meeting,
  days,
}: {
  token: string;
  meeting: PublicMeeting;
  days: DaySlots[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ startsAt: string; endsAt: string } | null>(null);

  const tz = meeting.timeZone;

  function confirm() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const res = await confirmRescheduleAction(token, selected);
      if (res.status === "ok") {
        setDone({ startsAt: res.meeting.startsAt, endsAt: res.meeting.endsAt });
        return;
      }
      setError(MESSAGES[res.status]);
      // The slot set is stale (something got taken / time passed) — refresh the
      // server-verified availability so the client re-picks from live slots.
      if (res.status === "slot_taken" || res.status === "slot_invalid") {
        setSelected(null);
        router.refresh();
      }
    });
  }

  if (done) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
        </div>
        <h1 className="font-display text-2xl font-extrabold text-ink-900">Meeting rescheduled</h1>
        <p className="mt-2 text-sm text-ink-500">Your meeting has been moved to:</p>
        <p className="mt-4 text-lg font-semibold text-ink-900">{fullWhen(done.startsAt, tz)}</p>
        <p className="mt-1 text-sm text-ink-400">{meeting.title}</p>
        <p className="mt-6 text-sm text-ink-500">
          A confirmation will be sent to you shortly. You can close this page.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50">
          <CalendarCheck className="h-6 w-6 text-brand-600" />
        </div>
        <h1 className="font-display text-2xl font-extrabold text-ink-900">Reschedule your meeting</h1>
        <p className="mt-2 text-sm font-medium text-ink-700">{meeting.title}</p>
        <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-ink-400">
          <Clock className="h-3.5 w-3.5" /> Currently {fullWhen(meeting.currentStartsAt, tz)}
        </p>
      </div>

      {days.length === 0 ? (
        <p className="rounded-xl bg-ink-50 px-4 py-6 text-center text-sm text-ink-500">
          There are no available times in the next two weeks. Please reply to your email and we&rsquo;ll
          help you find a time.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm font-semibold text-ink-800">Choose a new time</p>
          <div className="space-y-5">
            {days.map((day) => (
              <div key={day.dateYmd}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
                  {dayLabel(day.dateYmd)}
                </p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {day.slots.map((slot) => {
                    const isSel = selected === slot.startsAt;
                    return (
                      <button
                        key={slot.startsAt}
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          setSelected(slot.startsAt);
                          setError(null);
                        }}
                        aria-pressed={isSel}
                        className={[
                          "rounded-lg border px-2 py-2 text-sm font-medium transition",
                          isSel
                            ? "border-brand-500 bg-brand-500 text-white shadow-brand"
                            : "border-ink-200 bg-white text-ink-800 hover:border-brand-300 hover:bg-brand-50",
                          pending ? "opacity-60" : "",
                        ].join(" ")}
                      >
                        {timeLabel(slot.startsAt, tz)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {error && (
            <p className="mt-5 flex items-start gap-1.5 text-sm text-amber-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </p>
          )}

          <div className="mt-6">
            <Button
              className="w-full"
              size="lg"
              disabled={!selected || pending}
              loading={pending}
              onClick={confirm}
            >
              Confirm new time
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
