"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { advanceIntakeOnLoginAction } from "@/app/(client)/dashboard/actions";

/**
 * Fires once on first portal load to open a new client's onboarding
 * (portal_access_sent → onboarding_started). Renders nothing. The layout only
 * mounts this when the advance is actually needed, so it's a single no-op-safe
 * call, not a per-page-load cost.
 */
export function IntakeLoginAdvance() {
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    (async () => {
      await advanceIntakeOnLoginAction();
      router.refresh();
    })();
  }, [router]);

  return null;
}
