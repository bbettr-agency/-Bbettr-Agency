"use client";

import { useEffect, useState } from "react";
import { Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isJoinProminent } from "@/lib/planner/meetings/join-window";

/**
 * Join action for a meeting's EXISTING stored Google Meet URL
 * (calendar_projections.meet_url — never generates a URL, never calls Google).
 *
 * Visibility (locked): if there is no meet_url we render NOTHING (never a fake or
 * disabled Join). When a URL exists it is always reachable, but it becomes a
 * PROMINENT primary button from ~10 minutes before the start until the end;
 * outside that window it stays available as a subtle link. A lightweight 60s tick
 * flips it to prominent at T-10min without a page reload. Opens in a new tab.
 */

export function MeetingJoinButton({
  meetUrl,
  startsAt,
  endsAt,
  now,
}: {
  meetUrl: string | null;
  startsAt: string;
  endsAt: string;
  /** Server-provided clock for a stable first render (avoids hydration drift). */
  now?: Date;
}) {
  const [nowMs, setNowMs] = useState(() => (now ? now.getTime() : Date.now()));

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!meetUrl) return null; // never a fake/disabled Join

  if (isJoinProminent(nowMs, startsAt, endsAt)) {
    return (
      <Button asChild size="sm">
        <a href={meetUrl} target="_blank" rel="noreferrer">
          <Video className="h-4 w-4" /> Join meeting
        </a>
      </Button>
    );
  }

  return (
    <a
      href={meetUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
    >
      <Video className="h-4 w-4" /> Join Google Meet
    </a>
  );
}
