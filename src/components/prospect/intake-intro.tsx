"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IntakeShell } from "./intake-shell";
import { progressFor } from "@/lib/prospect/intake-steps";

/**
 * Public intake intro (P2-A, redesigned). The intro sits BEFORE any progress and
 * shows only what the prospect needs to begin — no six-section list. "Get
 * started" transitions (subtle fade) into the current-section frame to
 * demonstrate the shell + progress; the actual questions and the secure
 * draft-creation boundary arrive in later slices (P2-B/C/D). No DB writes, no
 * Turnstile (no mutations here yet). Portal typography (Sora/Inter) reused.
 */
export function IntakeIntro() {
  const [started, setStarted] = useState(false);

  if (!started) {
    return (
      <IntakeShell>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">
          Get started
        </p>
        <h1 className="mt-3 font-display text-3xl font-bold leading-[1.12] text-ink-900 sm:text-4xl">
          Tell us about your business.
        </h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-ink-500">
          Answer a few quick questions and we&rsquo;ll recommend the best next
          step.
        </p>
        <div className="mt-8">
          <Button size="lg" onClick={() => setStarted(true)} className="w-full sm:w-auto">
            Get started
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-5 text-xs text-ink-400">
          Takes about 3 minutes ·{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-ink-600">
            How we use your details
          </Link>
        </p>
      </IntakeShell>
    );
  }

  // Section 1 frame — progress + section intro. Fields land in P2-D.
  return (
    <IntakeShell progress={progressFor("business")}>
      <button
        type="button"
        onClick={() => setStarted(false)}
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 transition-colors hover:text-ink-800"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <h2 className="font-display text-2xl font-bold text-ink-900 sm:text-3xl">
        Tell us about your business.
      </h2>
      <p className="mt-3 text-base leading-relaxed text-ink-500">
        A few basics so we know who we&rsquo;re speaking with.
      </p>
    </IntakeShell>
  );
}
