"use client";

import { useState, useTransition } from "react";
import { HelpCircle, Phone, Mail, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { UPDATE_REACTIONS, type ReactionSummary } from "@/lib/update-reactions";
import {
  toggleUpdateReactionAction,
  requestUpdateFollowupAction,
} from "@/app/(client)/dashboard/updates/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import type { QuestionChannel } from "@/lib/database.types";

/**
 * Reaction bar for a project update. Clients (interactive) can toggle one emoji
 * and raise a ❓ "Question" that requests a callback or email. Admins see the
 * same bar read-only (counts only). Not a comment system.
 */
export function UpdateReactions({
  updateId,
  summary,
  interactive = false,
}: {
  updateId: string;
  summary?: ReactionSummary;
  interactive?: boolean;
}) {
  const counts = summary?.counts ?? {};
  const mine = summary?.mine ?? null;

  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<QuestionChannel>("callback");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function react(emoji: string) {
    if (!interactive) return;
    setError(null);
    startTransition(async () => {
      const res = await toggleUpdateReactionAction(updateId, emoji);
      if (res.error) setError(res.error);
    });
  }

  function sendQuestion() {
    setError(null);
    startTransition(async () => {
      const res = await requestUpdateFollowupAction(updateId, channel, message);
      if (res.error) {
        setError(res.error);
      } else {
        setSent(true);
        setOpen(false);
        setMessage("");
      }
    });
  }

  // Read-only (admin): show only emojis that have at least one reaction.
  if (!interactive) {
    const active = UPDATE_REACTIONS.filter((r) => (counts[r.emoji] ?? 0) > 0);
    if (active.length === 0) {
      return <p className="text-xs text-ink-300">No reactions yet</p>;
    }
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {active.map((r) => (
          <span
            key={r.emoji}
            className="inline-flex items-center gap-1 rounded-full bg-ink-50 px-2 py-0.5 text-xs text-ink-600"
            title={r.label}
          >
            <span>{r.emoji}</span>
            <span className="font-medium">{counts[r.emoji]}</span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {UPDATE_REACTIONS.map((r) => {
          const count = counts[r.emoji] ?? 0;
          const selected = mine === r.emoji;
          return (
            <button
              key={r.emoji}
              type="button"
              disabled={pending}
              onClick={() => react(r.emoji)}
              aria-pressed={selected}
              title={r.label}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                selected
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-ink-200 bg-white text-ink-600 hover:border-ink-300"
              )}
            >
              <span className="text-sm leading-none">{r.emoji}</span>
              {count > 0 && <span>{count}</span>}
            </button>
          );
        })}

        {/* The special ❓ Question */}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setSent(false);
            setOpen((o) => !o);
          }}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
            open
              ? "border-amber-400 bg-amber-50 text-amber-700"
              : "border-ink-200 bg-white text-ink-600 hover:border-ink-300"
          )}
        >
          <HelpCircle className="h-3.5 w-3.5" /> Question
        </button>

        {sent && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
            <Check className="h-3.5 w-3.5" /> Request sent — we&apos;ll be in touch
          </span>
        )}
      </div>

      {open && (
        <div className="rounded-xl border border-ink-100 bg-ink-50/50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-ink-700">
              Have a question? We&apos;ll follow up.
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-ink-400 hover:text-ink-600"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-2 flex gap-2">
            {(
              [
                { key: "callback", label: "Request a callback", Icon: Phone },
                { key: "email", label: "Request an email", Icon: Mail },
              ] as const
            ).map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setChannel(key)}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  channel === key
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-ink-200 bg-white text-ink-600 hover:border-ink-300"
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>

          <Textarea
            className="mt-2"
            rows={2}
            placeholder="Optional — anything you'd like to ask or add?"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

          <div className="mt-2 flex justify-end">
            <Button size="sm" loading={pending} onClick={sendQuestion}>
              Send request
            </Button>
          </div>
        </div>
      )}

      {error && !open && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
