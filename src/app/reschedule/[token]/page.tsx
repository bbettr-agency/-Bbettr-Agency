import type { Metadata } from "next";
import { CalendarX } from "lucide-react";
import { loadRescheduleView } from "@/lib/planner/meetings/reschedule-service";
import { RescheduleFlow } from "@/components/reschedule/reschedule-flow";

export const metadata: Metadata = { title: "Reschedule your meeting", robots: { index: false, follow: false } };

// Availability depends on the current time + live Portal/Google state — never
// statically cache or prerender this route.
export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-ink-100 bg-white p-6 shadow-sm sm:p-8">
        {children}
      </div>
    </main>
  );
}

/** Generic, non-revealing state for any unusable link (no enumeration). */
function InvalidCard() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-ink-100">
        <CalendarX className="h-8 w-8 text-ink-400" />
      </div>
      <h1 className="font-display text-2xl font-extrabold text-ink-900">Link no longer valid</h1>
      <p className="mt-2 text-sm text-ink-500">
        This rescheduling link is no longer valid. If you still need to change your meeting, please
        reply to your email and we&rsquo;ll be glad to help.
      </p>
    </div>
  );
}

function UnavailableCard() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50">
        <CalendarX className="h-8 w-8 text-amber-500" />
      </div>
      <h1 className="font-display text-2xl font-extrabold text-ink-900">Availability unavailable</h1>
      <p className="mt-2 text-sm text-ink-500">
        Availability is temporarily unavailable. Please try again shortly.
      </p>
    </div>
  );
}

export default async function ReschedulePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await loadRescheduleView(token);

  if (view.status === "invalid") return <Shell><InvalidCard /></Shell>;
  if (view.status === "unavailable") return <Shell><UnavailableCard /></Shell>;

  return (
    <Shell>
      <RescheduleFlow token={token} meeting={view.meeting} days={view.days} />
    </Shell>
  );
}
