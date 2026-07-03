import { Sparkles } from "lucide-react";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";

/**
 * Premium welcome hero for the client dashboard: a warm greeting plus the three
 * "is my project under control?" signals — completion %, current stage and
 * estimated launch — over a large animated progress bar. Presentation only.
 */
export function WelcomeHero({
  clientName,
  completion,
  currentStage,
  estimatedLaunchDate,
}: {
  clientName: string;
  completion: number;
  currentStage: string | null;
  estimatedLaunchDate: string | null;
}) {
  const pct = Math.max(0, Math.min(100, completion));
  const subtitle =
    pct >= 100
      ? "Your project is complete — congratulations! 🎉"
      : pct === 0
        ? "Welcome aboard — we’re getting your project underway."
        : "Your project is progressing beautifully.";
  // Warm, active fallback — "To be confirmed" reads like a shrug on day one.
  const launch = estimatedLaunchDate
    ? format(new Date(estimatedLaunchDate), "d MMM yyyy")
    : "We'll confirm shortly";

  return (
    <Card className="relative overflow-hidden border-0 bg-ink-900 text-white shadow-card-hover">
      <div
        className="relative p-7 sm:p-9"
        style={{
          backgroundImage:
            "radial-gradient(70% 120% at 90% 0%, rgba(56,182,255,0.35), transparent 55%)",
        }}
      >
        <div className="flex items-center gap-2 text-brand-300">
          <Sparkles className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-wider">
            Welcome back
          </span>
        </div>
        <h1 className="mt-2 font-display text-2xl font-bold sm:text-3xl">
          {clientName} 👋
        </h1>
        <p className="mt-1.5 text-sm text-white/70">{subtitle}</p>

        {/* Three at-a-glance signals */}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Stat label="Project completion" value={`${pct}%`} />
          <Stat label="Current stage" value={currentStage ?? "Getting started"} />
          <Stat label="Estimated launch" value={launch} />
        </div>

        {/* Large animated progress bar */}
        <div className="mt-6">
          <div className="h-3 w-full overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-300 to-brand-500 transition-all duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/10 p-4 backdrop-blur-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-white/55">
        {label}
      </p>
      <p className="mt-1 truncate text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
