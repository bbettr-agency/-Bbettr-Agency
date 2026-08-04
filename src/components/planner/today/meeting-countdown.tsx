"use client";

/**
 * The single Today client island: a live "starts in …" countdown for an imminent
 * meeting. Server-computed `initialMinutes` is rendered first (so SSR and the first
 * client render match — no hydration mismatch), then a timer recomputes from the
 * real start instant every 30s. Presentational only; no data access.
 */
import { useEffect, useState } from "react";
import { formatCountdown } from "@/lib/planner/meetings/date-views";

export function MeetingCountdown({ startsAt, initialMinutes }: { startsAt: string; initialMinutes: number }) {
  const [minutes, setMinutes] = useState(initialMinutes);
  useEffect(() => {
    const tick = () => setMinutes(Math.round((new Date(startsAt).getTime() - Date.now()) / 60000));
    const id = setInterval(tick, 30_000);
    tick();
    return () => clearInterval(id);
  }, [startsAt]);
  return (
    <span aria-live="polite">
      {minutes <= 0 ? "starting now" : `in ${formatCountdown(minutes)}`}
    </span>
  );
}
