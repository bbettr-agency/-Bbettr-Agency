import type { Metadata } from "next";
import { CheckCircle2, Clock, LinkIcon } from "lucide-react";
import { IntakeShell } from "@/components/prospect/intake-shell";
import { createProspectIntakeStore } from "@/lib/prospect/intake-store";
import { resolveIntakeView } from "@/lib/prospect/intake-server";

/**
 * Tokenised public intake route (P2-C). Resolves the raw token securely
 * server-side and renders a MINIMAL lifecycle-state surface — enough to prove
 * draft / submitted / expired / closed resolution. The full six-step form is
 * P2-D. The raw token is never placed in metadata or logs.
 */
export const metadata: Metadata = {
  title: "Your Bbettr intake",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function StartTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await resolveIntakeView(createProspectIntakeStore(), token);

  if (resolved.kind === "ok") {
    return (
      <IntakeShell>
        <h1 className="font-display text-2xl font-bold text-ink-900 sm:text-3xl">
          Welcome back.
        </h1>
        <p className="mt-3 text-base leading-relaxed text-ink-500 lg:text-lg">
          Your details are saved — you can pick up right where you left off.
        </p>
      </IntakeShell>
    );
  }

  if (resolved.kind === "already_submitted") {
    return (
      <IntakeShell>
        <div className="flex items-center gap-2 text-emerald-600">
          <CheckCircle2 className="h-5 w-5" />
          <span className="text-sm font-semibold">Received</span>
        </div>
        <h1 className="mt-3 font-display text-2xl font-bold text-ink-900 sm:text-3xl">
          Thanks — we&rsquo;ve got it.
        </h1>
        <p className="mt-3 text-base leading-relaxed text-ink-500">
          We&rsquo;ve received your details and will be in touch. Need to change
          something? Just reply to our email.
        </p>
      </IntakeShell>
    );
  }

  const expired = resolved.kind === "expired";
  return (
    <IntakeShell>
      <div className="flex items-center gap-2 text-ink-400">
        {expired ? <Clock className="h-5 w-5" /> : <LinkIcon className="h-5 w-5" />}
        <span className="text-sm font-semibold">
          {expired ? "Link expired" : "Link unavailable"}
        </span>
      </div>
      <h1 className="mt-3 font-display text-2xl font-bold text-ink-900 sm:text-3xl">
        {expired ? "This link has expired." : "This link is no longer active."}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-ink-500">
        You can start a new one any time, or reach us at{" "}
        <a href="mailto:info@bbettragency.com" className="font-medium text-brand-600 hover:text-brand-700">
          info@bbettragency.com
        </a>
        .
      </p>
    </IntakeShell>
  );
}
