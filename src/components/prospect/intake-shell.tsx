import { Logo } from "@/components/brand/logo";
import { IntakeProgress } from "./intake-progress";
import type { ProgressView } from "@/lib/prospect/intake-steps";

/**
 * Public prospect-intake shell (P2-A, redesigned).
 *
 * A light, focused, single-column composition that belongs to the Bbettr Portal
 * — not a dark 50/50 split, not a floating card. A compact brand header sits on
 * an off-white page with ONE restrained brand-blue ambient glow; the content is
 * a controlled ~640px column centred around the vertical middle. Portal
 * typography (Inter body / Sora headings) is inherited.
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
    <div className="relative min-h-screen bg-ink-50 text-ink-900">
      {/* One subtle brand ambient glow — the only decorative element. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[70vh]"
        style={{
          backgroundImage:
            "radial-gradient(60% 60% at 50% 0%, rgba(56,182,255,0.10), transparent 70%)",
        }}
      />

      {/* Compact brand header */}
      <header className="relative mx-auto flex w-full max-w-3xl items-center px-5 py-5 sm:px-8">
        <Logo />
      </header>

      {/* Focused content column, composed around the vertical centre. */}
      <main className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 pb-16 sm:px-8">
        <div className="mx-auto w-full max-w-xl py-10 sm:py-16 lg:py-20">
          {progress && (
            <div className="mb-9">
              <IntakeProgress progress={progress} />
            </div>
          )}
          <div className="motion-safe:animate-fade-in">{children}</div>
        </div>
      </main>
    </div>
  );
}
