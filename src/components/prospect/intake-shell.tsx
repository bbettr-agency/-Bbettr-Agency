import { Logo } from "@/components/brand/logo";
import { INTAKE_SECTIONS } from "@/lib/prospect/intake-steps";
import { IntakeProgress } from "./intake-progress";
import type { ProgressView } from "@/lib/prospect/intake-steps";

/**
 * Editorial split-layout frame for the public prospect intake (P2-A).
 *
 * Desktop (lg+): a fixed brand panel on the left (dark, with the section index)
 * and a restrained content column on the right — not a stretched mobile form.
 * Mobile/tablet: a slim brand bar on top, content below in a single column.
 *
 * Typography is the scoped editorial pairing (Playfair Display + DM Sans) set by
 * app/start/layout.tsx; this frame just uses `font-editorial*` utilities.
 */
export function IntakeShell({
  progress,
  children,
}: {
  /** When present, the current-section progress is shown above the content. */
  progress?: ProgressView | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-ink-50 lg:grid lg:grid-cols-[minmax(0,42%)_minmax(0,58%)]">
      {/* Left brand panel — desktop only */}
      <aside className="relative hidden overflow-hidden bg-ink-900 text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(60% 90% at 15% 0%, rgba(56,182,255,0.28), transparent 60%)",
          }}
        />
        <div className="relative">
          <Logo variant="light" />
        </div>
        <div className="relative">
          <p className="font-editorial-display text-3xl font-semibold leading-tight xl:text-4xl">
            Marketing that makes you&nbsp;Bbettr.
          </p>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/60">
            A few quick questions so we understand your business and what you
            need. No commitment — we&rsquo;ll review it and recommend the best
            next step.
          </p>
        </div>
        <ol className="relative space-y-2.5 text-sm text-white/50">
          {INTAKE_SECTIONS.map((s) => (
            <li key={s.id} className="flex items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/15 text-[11px] font-medium text-white/70">
                {s.index}
              </span>
              {s.label}
            </li>
          ))}
        </ol>
      </aside>

      {/* Mobile brand bar */}
      <header className="flex items-center justify-between border-b border-ink-100 bg-white px-5 py-4 lg:hidden">
        <Logo />
      </header>

      {/* Content column */}
      <main className="flex flex-col px-5 py-8 sm:px-8 lg:px-12 lg:py-14">
        <div className="mx-auto w-full max-w-md">
          {progress && (
            <div className="mb-8">
              <IntakeProgress progress={progress} />
            </div>
          )}
          <div className="animate-fade-in">{children}</div>
        </div>
      </main>
    </div>
  );
}
