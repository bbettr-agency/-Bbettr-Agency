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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { sendPortalEmailAction } from "@/app/(admin)/admin/actions";
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
  const [sentKind, setSentKind] = useState<EmailKind | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(
    null
  );

  function copy(label: string, value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
    });
  }

  function sendEmail(kind: EmailKind, label: string) {
    setFeedback(null);
    setSentKind(kind);
    startTransition(async () => {
      const res = await sendPortalEmailAction(clientId, kind);
      setSentKind(null);
      setFeedback(
        res.error
          ? { ok: false, msg: res.error }
          : { ok: true, msg: `${label} sent to ${access.email}.` }
      );
    });
  }

  const credentials = `Portal: ${portalUrl}\nEmail: ${access.email ?? "—"}`;

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
            loading={pending && sentKind === "welcome"}
            disabled={pending || !access.email}
            onClick={() => sendEmail("welcome", "Welcome email")}
          >
            <Send className="h-4 w-4" /> Send welcome email
          </Button>
          <Button
            variant="outline"
            size="sm"
            loading={pending && sentKind === "resend_credentials"}
            disabled={pending || !access.email}
            onClick={() => sendEmail("resend_credentials", "Credentials")}
          >
            <RotateCcw className="h-4 w-4" /> Resend credentials
          </Button>
          <Button
            variant="outline"
            size="sm"
            loading={pending && sentKind === "password_reset"}
            disabled={pending || !access.email}
            onClick={() => sendEmail("password_reset", "Password reset")}
          >
            <KeyRound className="h-4 w-4" /> Reset password
          </Button>
        </div>

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
