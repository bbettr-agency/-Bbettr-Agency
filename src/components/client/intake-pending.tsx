import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * Calm holding panel shown to NEW intake clients before their onboarding opens.
 * Reassuring, non-blocking, and premium — never an empty or broken dashboard.
 */
export function IntakePending({
  clientName,
  intakeStatus,
}: {
  clientName: string;
  intakeStatus: string;
}) {
  const subtitle =
    intakeStatus === "paid" || intakeStatus === "portal_access_sent"
      ? "Thanks — that's all sorted. We're getting your space ready and will open the next step for you shortly."
      : "Your agreement is being prepared. We'll notify you the moment the next step is ready.";

  return (
    <div className="flex min-h-[60vh] items-center justify-center animate-fade-in">
      <Card className="relative max-w-lg overflow-hidden border-0 bg-ink-900 text-white shadow-card-hover">
        <div
          className="p-8 sm:p-10 text-center"
          style={{
            backgroundImage:
              "radial-gradient(70% 120% at 50% 0%, rgba(56,182,255,0.35), transparent 60%)",
          }}
        >
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
            <Sparkles className="h-6 w-6 text-brand-300" />
          </span>
          <h1 className="font-display text-2xl font-bold">
            Welcome, {clientName} 👋
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-white/70">
            {subtitle}
          </p>
          <p className="mt-6 text-xs text-white/45">
            There&rsquo;s nothing you need to do right now.
          </p>
        </div>
      </Card>
    </div>
  );
}
