"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { IntakeShell } from "./intake-shell";
import { progressFor } from "@/lib/prospect/intake-steps";

/**
 * Public intake intro (P2-A). The intro sits BEFORE the progress bar. "Get
 * started" transitions into the section frame (progress + section heading) to
 * demonstrate the shell + progress foundation — the actual questions and the
 * secure draft-creation on completing "Your business" arrive in later slices
 * (P2-B/C/D). No database writes, no Turnstile (no mutations here yet).
 */
export function IntakeIntro() {
  const [started, setStarted] = useState(false);

  if (!started) {
    return (
      <IntakeShell>
        <div className="animate-fade-in">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
            Get started
          </p>
          <h1 className="mt-3 font-editorial-display text-4xl font-semibold leading-[1.1] text-ink-900 sm:text-5xl">
            Let&rsquo;s get started.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-ink-600">
            Tell us a little about your business and what you&rsquo;d like help
            with. We&rsquo;ll review it and recommend the best next step.
          </p>
          <button
            type="button"
            onClick={() => setStarted(true)}
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-brand-500 px-6 py-3 text-sm font-semibold text-white shadow-brand transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2"
          >
            Get started
            <ArrowRight className="h-4 w-4" />
          </button>
          <p className="mt-5 text-xs text-ink-400">
            Takes about 3 minutes ·{" "}
            <Link href="/privacy" className="underline hover:text-ink-600">
              How we use your details
            </Link>
          </p>
        </div>
      </IntakeShell>
    );
  }

  // Section 1 frame — progress foundation + section intro. Inputs land in P2-D.
  return (
    <IntakeShell progress={progressFor("business")}>
      <button
        type="button"
        onClick={() => setStarted(false)}
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <h2 className="font-editorial-display text-3xl font-semibold text-ink-900">
        Your business
      </h2>
      <p className="mt-4 text-base leading-relaxed text-ink-600">
        Just the basics so we know who we&rsquo;re talking to — your name, your
        business, and the best email to reach you.
      </p>
    </IntakeShell>
  );
}
