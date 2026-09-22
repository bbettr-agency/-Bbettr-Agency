import { format } from "date-fns";
import { ExternalLink, Flag, Rocket } from "lucide-react";
import type { OverviewHeaderView } from "@/lib/client-overview";
import { Card } from "@/components/ui/card";

/**
 * The Client Overview's primary anchor (CX2) — a calm, premium header that
 * answers "Where are we?" and "What happens next?" in one glance. It adapts to
 * the canonical lifecycle: development shows progress paired with stage context
 * and the next milestone; once launched it drops the development framing and
 * promotes the live site. Presentation only — every value is pre-derived.
 */
export function ProjectStateHeader({
  clientName,
  header,
}: {
  clientName: string;
  header: OverviewHeaderView;
}) {
  const pct = Math.max(0, Math.min(100, header.progressPercent));
  const nextDate = header.nextMilestoneDate
    ? format(new Date(header.nextMilestoneDate), "d MMM yyyy")
    : null;
  const launchDate = header.estimatedLaunchDate
    ? format(new Date(header.estimatedLaunchDate), "MMMM yyyy")
    : null;
  const showMilestones =
    !header.launched && (header.nextMilestoneLabel || launchDate);

  return (
    <Card className="relative overflow-hidden border-0 bg-ink-900 text-white shadow-card-hover">
      <div
        className="relative p-6 sm:p-8"
        style={{
          backgroundImage:
            "radial-gradient(70% 120% at 90% 0%, rgba(56,182,255,0.35), transparent 55%)",
        }}
      >
        <div className="flex items-center gap-2 text-brand-300">
          {header.launched ? (
            <Rocket className="h-4 w-4" />
          ) : (
            <Flag className="h-4 w-4" />
          )}
          <span className="text-xs font-semibold uppercase tracking-wider">
            {header.eyebrow}
          </span>
        </div>

        <h1 className="mt-2 font-display text-2xl font-bold leading-tight sm:text-3xl">
          {header.headline}
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-white/70">
          {header.subcopy}
        </p>

        {/* Progress — NEVER shown alone; always paired with stage context. */}
        {header.showProgress && (
          <div className="mt-6">
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
              <span className="font-display text-3xl font-bold tabular-nums sm:text-4xl">
                {pct}%
              </span>
              {header.stageContext && (
                <span className="text-sm font-medium text-white/70">
                  {header.stageContext}
                </span>
              )}
            </div>
            <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-300 to-brand-500 transition-all duration-700 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Next milestone + estimated launch — the "what happens next" facts. */}
        {showMilestones && (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {header.nextMilestoneLabel && (
              <Stat
                label="Next milestone"
                value={header.nextMilestoneLabel}
                sub={nextDate}
              />
            )}
            {launchDate && <Stat label="Estimated launch" value={launchDate} />}
          </div>
        )}

        {/* Lifecycle CTA (preview / visit) — one clear, real link, never faked. */}
        {header.cta && (
          <div className="mt-6">
            <a
              href={header.cta.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-ink-900 shadow-sm transition-colors hover:bg-white/90"
            >
              {header.cta.label}
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        )}

        <p className="sr-only">Signed in as {clientName}</p>
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div className="rounded-2xl bg-white/10 p-4 backdrop-blur-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-white/55">
        {label}
      </p>
      <p className="mt-1 break-words text-lg font-semibold text-white">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-white/55">{sub}</p>}
    </div>
  );
}
