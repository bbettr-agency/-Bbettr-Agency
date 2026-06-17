"use client";

import { useState, useTransition } from "react";
import { formatDistanceToNow, format } from "date-fns";
import {
  Link2,
  Mail,
  Copy,
  Check,
  Send,
  RotateCcw,
  KeyRound,
  Clock,
  CheckCircle2,
  AlertCircle,
  Eye,
  ClipboardList,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  sendPortalEmailAction,
  resetTempPasswordAction,
} from "@/app/(admin)/admin/actions";
import type { PortalAccess } from "@/lib/admin-queries";
import type { EmailKind } from "@/lib/email";

export function PortalAccessCard({
  clientId,
  portalUrl,
  access,
}: {
  clientId: string;
  portalUrl: string;
  access: PortalAccess;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(
    null
  );

  function copy(label: string, value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
    });
  }

  // Credentials include the temporary password only when one has been generated
  // this session (it is never stored, so it isn't available on a fresh load).
  const credentials = [
    `Portal: ${portalUrl}`,
    `Email: ${access.email ?? "—"}`,
    ...(tempPassword ? [`Temporary password: ${tempPassword}`] : []),
  ].join("\n");

  // Manual fallback to share when email delivery is unavailable (e.g. Supabase
  // rate limit). Includes step-by-step login instructions.
  const loginInstructions = [
    `Your Bbettr Agency portal access`,
    ``,
    `Portal: ${portalUrl}`,
    `Email: ${access.email ?? "—"}`,
    `Temporary password: ${
      tempPassword ?? "(ask your account manager to generate one)"
    }`,
    ``,
    `1. Open the portal link above.`,
    `2. Sign in with your email and the temporary password.`,
    `3. Change your password after your first login.`,
  ].join("\n");

  function sendEmail(kind: EmailKind, label: string) {
    setFeedback(null);
    setBusy(kind);
    startTransition(async () => {
      const res = await sendPortalEmailAction(clientId, kind);
      setBusy(null);
      // welcome / resend mint a fresh temp password and return it once — show it
      // so the admin keeps a copy even after it's been emailed.
      if (res.password) setTempPassword(res.password);
      setFeedback(
        res.error
          ? { ok: false, msg: res.error }
          : {
              ok: true,
              msg: `${label} sent to ${access.email} with login credentials.`,
            }
      );
    });
  }

  function resetPassword() {
    setFeedback(null);
    setBusy("reset");
    startTransition(async () => {
      const res = await resetTempPasswordAction(clientId);
      setBusy(null);
      if (res.error) {
        setFeedback({ ok: false, msg: res.error });
        return;
      }
      setTempPassword(res.password ?? null);
      setFeedback({
        ok: true,
        msg: "New temporary password generated — copy it now (shown once).",
      });
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4.5 w-4.5 text-brand-500" />
          <CardTitle>Portal Access</CardTitle>
        </div>
        {access.hasLogin ? (
          access.lastSignInAt ? (
            <Badge tone="success" dot>
              Active
            </Badge>
          ) : (
            <Badge tone="warning" dot>
              Never logged in
            </Badge>
          )
        ) : (
          <Badge tone="neutral" dot>
            No login
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Portal URL + email rows */}
        <div className="space-y-2">
          <Row
            icon={Link2}
            label="Portal URL"
            value={portalUrl}
            copied={copied === "url"}
            onCopy={() => copy("url", portalUrl)}
          />
          <Row
            icon={Mail}
            label="Client email"
            value={access.email ?? "—"}
            copied={copied === "email"}
            onCopy={() => access.email && copy("email", access.email)}
          />
        </div>

        {/* Temporary password — shown once, after a reset */}
        {tempPassword ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center gap-1.5 text-amber-700">
              <Eye className="h-3.5 w-3.5" />
              <span className="text-xs font-semibold">
                Temporary password (shown once)
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="flex-1 rounded-lg bg-white px-2.5 py-1.5 font-mono text-sm text-ink-900 ring-1 ring-inset ring-amber-200">
                {tempPassword}
              </code>
              <button
                onClick={() => copy("pw", tempPassword)}
                className="rounded-lg p-1.5 text-amber-600 hover:bg-amber-100"
                aria-label="Copy password"
              >
                {copied === "pw" ? (
                  <Check className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-amber-700">
              Share securely. Ask the client to change it after their first login.
            </p>
          </div>
        ) : (
          <p className="flex items-start gap-1.5 rounded-xl bg-ink-50 p-3 text-xs text-ink-500">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Passwords are never stored. Use <strong>Reset Password</strong> to
            generate a new temporary password you can copy and share.
          </p>
        )}

        {/* Login activity */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-ink-100 p-3">
            <div className="flex items-center gap-1.5 text-ink-400">
              <Clock className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">Last login</span>
            </div>
            <p className="mt-1 text-sm font-semibold text-ink-900">
              {access.lastSignInAt
                ? `${formatDistanceToNow(new Date(access.lastSignInAt))} ago`
                : "Never logged in"}
            </p>
          </div>
          <div className="rounded-xl border border-ink-100 p-3">
            <div className="flex items-center gap-1.5 text-ink-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">Account created</span>
            </div>
            <p className="mt-1 text-sm font-semibold text-ink-900">
              {access.createdAt
                ? format(new Date(access.createdAt), "d MMM yyyy")
                : "—"}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy("creds", credentials)}
          >
            {copied === "creds" ? (
              <Check className="h-4 w-4 text-emerald-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            Copy credentials
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy("instructions", loginInstructions)}
          >
            {copied === "instructions" ? (
              <Check className="h-4 w-4 text-emerald-500" />
            ) : (
              <ClipboardList className="h-4 w-4" />
            )}
            Copy login instructions
          </Button>
          <Button
            variant="outline"
            size="sm"
            loading={busy === "reset"}
            disabled={pending}
            onClick={resetPassword}
          >
            <KeyRound className="h-4 w-4" /> Reset password
          </Button>
          <Button
            variant="outline"
            size="sm"
            loading={busy === "welcome"}
            disabled={pending || !access.email}
            onClick={() => sendEmail("welcome", "Welcome email")}
          >
            <Send className="h-4 w-4" /> Send welcome email
          </Button>
          <Button
            variant="outline"
            size="sm"
            loading={busy === "resend_credentials"}
            disabled={pending || !access.email}
            onClick={() => sendEmail("resend_credentials", "Access email")}
          >
            <RotateCcw className="h-4 w-4" /> Resend credentials
          </Button>
        </div>

        {/* Helper text — what each action does */}
        <ul className="space-y-1 text-xs text-ink-400">
          <li>
            <strong className="text-ink-500">Copy credentials</strong> — copies
            the portal URL, email{tempPassword ? " and temporary password" : ""}.
          </li>
          <li>
            <strong className="text-ink-500">Copy login instructions</strong> —
            copies a ready-to-send message with the link, email, password &amp;
            steps (use this if email sending is unavailable).
          </li>
          <li>
            <strong className="text-ink-500">Reset password</strong> — generates
            a new temporary password to copy &amp; share (does not email it).
          </li>
          <li>
            <strong className="text-ink-500">Send welcome email</strong> —
            generates a fresh temporary password and emails the client their
            portal URL, login email &amp; password (shown here once too).
          </li>
          <li>
            <strong className="text-ink-500">Resend credentials</strong> —
            same as above: a new temporary password is generated and emailed
            (the previous one stops working).
          </li>
        </ul>

        {feedback && (
          <p
            className={`flex items-center gap-1.5 text-sm ${
              feedback.ok ? "text-emerald-600" : "text-red-600"
            }`}
          >
            {feedback.ok ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            {feedback.msg}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  copied,
  onCopy,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-ink-100 p-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-50 text-ink-400">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-ink-400">{label}</p>
        <p className="truncate text-sm font-medium text-ink-900">{value}</p>
      </div>
      <button
        onClick={onCopy}
        className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
        aria-label={`Copy ${label}`}
      >
        {copied ? (
          <Check className="h-4 w-4 text-emerald-500" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
