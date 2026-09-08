import type { Metadata } from "next";
import { CheckCircle2, Clock, LinkIcon } from "lucide-react";
import { IntakeShell } from "@/components/prospect/intake-shell";
import { IntakeFlow } from "@/components/prospect/intake-flow";
import { ReviewSection } from "@/components/prospect/intake-sections";
import { createProspectIntakeStore } from "@/lib/prospect/intake-store";
import { resolveIntakeView } from "@/lib/prospect/intake-server";
import { resumeSection } from "@/lib/prospect/intake-resume";

/**
 * Tokenised public intake route (P2-D). The raw token is resolved securely
 * server-side (P2-C) and NEVER placed in metadata or logs. A live draft hydrates
 * the interactive flow at a deterministic resume section; submitted renders a
 * read-only summary; expired / converted / dismissed render closed states. All
 * states are non-enumerating (unknown/terminal/expired never reveal which).
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

  // Live draft → resume the interactive flow where the prospect left off.
  if (resolved.kind === "ok" && resolved.view) {
    return (
      <IntakeFlow
        mode="resume"
        initialToken={token}
        initialData={resolved.view.data}
        initialSection={resumeSection(resolved.view.data)}
      />
    );
  }

  // Submitted → read-only summary, no edit/save controls.
  if (resolved.kind === "already_submitted" && resolved.view) {
    return (
      <IntakeShell>
        <div className="flex items-center gap-2 text-emerald-600">
          <CheckCircle2 className="h-5 w-5" />
          <span className="text-sm font-semibold">Received</span>
        </div>
        <h1 className="mt-3 font-display text-2xl font-bold text-ink-900 sm:text-3xl">
          You&rsquo;ve already sent this to us — we&rsquo;re on it.
        </h1>
        <p className="mt-3 text-base leading-relaxed text-ink-500">
          Here&rsquo;s what you shared. Need to change something? Just reply to our email or reach us at{" "}
          <a href="mailto:info@bbettragency.com" className="font-medium text-brand-600 hover:text-brand-700">
            info@bbettragency.com
          </a>
          .
        </p>
        <div className="mt-8">
          <ReviewSection data={resolved.view.data} readOnly />
        </div>
      </IntakeShell>
    );
  }

  // Expired vs. converted/dismissed/unknown — both closed, non-enumerating.
  const expired = resolved.kind === "expired";
  return (
    <IntakeShell>
      <div className="flex items-center gap-2 text-ink-400">
        {expired ? <Clock className="h-5 w-5" /> : <LinkIcon className="h-5 w-5" />}
        <span className="text-sm font-semibold">{expired ? "Link expired" : "Link unavailable"}</span>
      </div>
      <h1 className="mt-3 font-display text-2xl font-bold text-ink-900 sm:text-3xl">
        {expired ? "This link has expired." : "This link is no longer active."}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-ink-500">
        {expired
          ? "You can start a new one at any time."
          : "You can start a new one, or reach us any time."}{" "}
        <a href="mailto:info@bbettragency.com" className="font-medium text-brand-600 hover:text-brand-700">
          info@bbettragency.com
        </a>
      </p>
    </IntakeShell>
  );
}
