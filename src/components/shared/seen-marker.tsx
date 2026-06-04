"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { markSectionViewedAction } from "@/app/(client)/dashboard/actions";
import type { NotifySection } from "@/lib/queries";

/**
 * Marks a portal section as viewed when the client opens it, clearing its
 * sidebar notification dot. Renders nothing. Runs once on mount, then refreshes
 * so the layout recomputes the sidebar badges.
 */
export function SeenMarker({ section }: { section: NotifySection }) {
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    (async () => {
      await markSectionViewedAction(section);
      router.refresh();
    })();
  }, [section, router]);

  return null;
}
