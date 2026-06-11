"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  KeyRound,
  Send,
  Copy,
  Check,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  setRepActiveAction,
  resetRepPasswordAction,
  sendRepEmailAction,
  sendRepWelcomeEmailAction,
} from "@/app/(admin)/admin/reps/actions";

export function RepAccessControl({
  repId,
  active,
}: {
  repId: string;
  active: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(active);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(
    null
  );

  function toggleActive() {
    const next = !isActive;
    setFeedback(null);
    setIsActive(next);
    setBusy("active");
    startTransition(async () => {
      const res = await setRepActiveAction(repId, next);
      setBusy(null);
      if (res.error) {
        setIsActive(!next);
        setFeedback({ ok: false, msg: res.error });
      } else {
        router.refresh();
      }
    });
  }

  function resetPassword() {
    setFeedback(null);
    setBusy("reset");
    startTransition(async () => {
      const res = await resetRepPasswordAction(repId);
      setBusy(null);
      if (res.error) setFeedback({ ok: false, msg: res.error });
      else {
        setTempPassword(res.password ?? null);
        setFeedback({ ok: true, msg: "New temporary password generated." });
      }
    });
  }

  function sendEmail(kind: "password_reset", label: string) {
    setFeedback(null);
    setBusy(kind);
    startTransition(async () => {
      const res = await sendRepEmailAction(repId, kind);
      setBusy(null);
      setFeedback(
        res.error ? { ok: false, msg: res.error } : { ok: true, msg: `${label} sent.` }
      );
    });
  }

  // Welcome email includes login credentials, so it needs a password we have in
  // this session. Reset the password first to generate one (we never read a
  // stored password).
  function sendWelcome() {
    setFeedback(null);
    if (!tempPassword) {
      setFeedback({
        ok: false,
        msg: "Reset the password first, then send the welcome email so it can include login credentials.",
      });
      return;
    }
    setBusy("welcome");
    startTransition(async () => {
      const res = await sendRepWelcomeEmailAction(repId, tempPassword);
      setBusy(null);
      setFeedback(
        res.error
          ? { ok: false, msg: res.error }
          : { ok: true, msg: "Welcome email sent with login credentials." }
      );
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-ink-700">Account status</p>
          <p className="text-xs text-ink-400">
            {isActive ? "Active — can log in and create deals." : "Inactive."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isActive}
          aria-label="Toggle rep active"
          disabled={pending && busy === "active"}
          onClick={toggleActive}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
            isActive ? "bg-emerald-500" : "bg-ink-200"
          )}
        >
          <span
            className={cn(
              "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
              isActive ? "translate-x-[22px]" : "translate-x-0.5"
            )}
          />
        </button>
      </div>

      {tempPassword && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-700">
            Temporary password (shown once)
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-white px-2.5 py-1.5 font-mono text-sm text-ink-900 ring-1 ring-inset ring-amber-200">
              {tempPassword}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(tempPassword);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="rounded-lg p-1.5 text-amber-600 hover:bg-amber-100"
              aria-label="Copy password"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2 border-t border-ink-100 pt-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" loading={busy === "reset"} disabled={pending} onClick={resetPassword}>
            <KeyRound className="h-4 w-4" /> Reset password
          </Button>
          <Button variant="outline" size="sm" loading={busy === "welcome"} disabled={pending} onClick={sendWelcome}>
            <Send className="h-4 w-4" /> Send welcome email
          </Button>
          <Button variant="outline" size="sm" loading={busy === "password_reset"} disabled={pending} onClick={() => sendEmail("password_reset", "Password reset email")}>
            <KeyRound className="h-4 w-4" /> Send reset email
          </Button>
        </div>
        <p className="text-xs text-ink-400">
          The welcome email includes the login URL, the rep&rsquo;s email and a
          temporary password. Reset the password first to generate one — stored
          passwords can&rsquo;t be retrieved.
        </p>
      </div>

      {feedback && (
        <p className={cn("flex items-center gap-1.5 text-sm", feedback.ok ? "text-emerald-600" : "text-red-600")}>
          {feedback.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {feedback.msg}
        </p>
      )}
    </div>
  );
}
