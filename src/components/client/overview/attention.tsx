"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { resolveActionItemAction } from "@/app/(client)/dashboard/actions";
import type { OverviewAttentionView, OverviewActionView } from "@/lib/client-overview";

/**
 * The ONE authoritative "do you need anything from me?" surface (CX2). It shows
 * either the single highest-priority action (with a clear CTA, and — for an
 * admin-authored notification — a Mark done control), any further actions folded
 * quietly beneath, OR a calm all-caught-up reassurance when nothing is needed.
 * The absence of a warning is stated, never left to guesswork.
 */
export function OverviewAttention({ attention }: { attention: OverviewAttentionView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  function markDone(id: string) {
    setBusyId(id);
    startTransition(async () => {
      await resolveActionItemAction(id);
      setBusyId(null);
      router.refresh();
    });
  }

  if (!attention.hasAction || !attention.primary) {
    return (
      <Card className="border-emerald-100 bg-emerald-50/40">
        <CardContent className="flex items-center gap-3 p-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-900">You’re all caught up</p>
            <p className="text-sm text-ink-500">
              There’s nothing we need from you right now.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { primary, others } = attention;

  return (
    <Card className="border-amber-200 bg-amber-50/50">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-amber-700">
          <Sparkles className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-wider">
            Needs your attention
          </span>
        </div>

        {/* Primary action — the one thing that matters most, given real weight. */}
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="break-words text-base font-semibold text-ink-900">
              {primary.title}
            </p>
            {primary.body && (
              <p className="mt-0.5 break-words text-sm text-ink-600">{primary.body}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <PrimaryCta action={primary} />
            {primary.notificationId && (
              <Button
                variant="outline"
                size="md"
                loading={pending && busyId === primary.notificationId}
                disabled={pending}
                onClick={() => markDone(primary.notificationId!)}
              >
                <Check className="h-4 w-4" /> Mark done
              </Button>
            )}
          </div>
        </div>

        {/* Anything else, folded quietly so it's reachable without competing. */}
        {others.length > 0 && (
          <ul className="mt-4 space-y-2 border-t border-amber-200/70 pt-4">
            {others.map((a, i) => (
              <li
                key={a.notificationId ?? `${a.kind}-${i}`}
                className="flex flex-col gap-2 rounded-xl bg-white/70 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900">{a.title}</p>
                  {a.body && <p className="mt-0.5 text-xs text-ink-500">{a.body}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <SecondaryCta action={a} />
                  {a.notificationId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={pending && busyId === a.notificationId}
                      disabled={pending}
                      onClick={() => markDone(a.notificationId!)}
                    >
                      <Check className="h-4 w-4" /> Done
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PrimaryCta({ action }: { action: OverviewActionView }) {
  if (!action.href) return null;
  if (action.external) {
    return (
      <Button asChild>
        <a href={action.href} target="_blank" rel="noopener noreferrer">
          {action.ctaLabel} <ExternalLink className="h-4 w-4" />
        </a>
      </Button>
    );
  }
  return (
    <Button asChild>
      <Link href={action.href}>
        {action.ctaLabel} <ArrowRight className="h-4 w-4" />
      </Link>
    </Button>
  );
}

function SecondaryCta({ action }: { action: OverviewActionView }) {
  if (!action.href) return null;
  if (action.external) {
    return (
      <Button asChild variant="outline" size="sm">
        <a href={action.href} target="_blank" rel="noopener noreferrer">
          Open <ExternalLink className="h-4 w-4" />
        </a>
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={action.href}>
        Open <ArrowRight className="h-4 w-4" />
      </Link>
    </Button>
  );
}
