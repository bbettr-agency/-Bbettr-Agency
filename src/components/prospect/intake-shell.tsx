import { Logo } from "@/components/brand/logo";
import { IntakeProgress } from "./intake-progress";
import type { ProgressView } from "@/lib/prospect/intake-steps";

/**
 * Public prospect-intake shell (P2-A). A light, focused, single-column
 * composition that belongs to the Bbettr Portal — no dark split, no floating
 * card. An anchored brand header (aligned to the content width, with a hairline
 * boundary) sits on an off-white page with ONE restrained brand-blue ambient
 * glow; the content is a ~624px column composed around the vertical centre of
 * the usable area beneath the header. Portal typography (Inter/Sora) inherited.
 */

/** Shared content width so the header and body left/right edges align exactly. */
const CONTENT = "mx-auto w-full max-w-[624px] px-6 sm:px-8";

export function IntakeShell({
  progress,
  children,
}: {
  /** When present, the current-section progress is shown above the content. */
  progress?: ProgressView | null;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col bg-ink-50 text-ink-900">
      {/* One subtle brand ambient glow — the only decorative element. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[60vh]"
        style={{
          backgroundImage:
            "radial-gradient(55% 55% at 50% 0%, rgba(56,182,255,0.10), transparent 72%)",
        }}
      />

      {/* Anchored brand header — hairline boundary, aligned to content width. */}
      <header className="relative border-b border-ink-100/70">
        <div className={`${CONTENT} flex items-center py-5`}>
          <Logo />
        </div>
      </header>

      {/* Content, centred within the usable area (below the header). */}
      <main className="relative flex flex-1 flex-col justify-center">
        <div className={`${CONTENT} py-12 sm:py-16`}>
          {progress && (
            <div className="mb-10">
              <IntakeProgress progress={progress} />
            </div>
          )}
          <div className="motion-safe:animate-fade-in">{children}</div>
        </div>
      </main>
    </div>
  );
}
