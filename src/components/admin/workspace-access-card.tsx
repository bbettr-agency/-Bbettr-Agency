"use client";

import { useState, useTransition } from "react";
import {
  Users,
  UserPlus,
  ShieldCheck,
  Mail,
  KeyRound,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { WorkspaceMember } from "@/lib/admin-queries";
import {
  grantWorkspaceAccessAction,
  revokeWorkspaceAccessAction,
  sendMemberPasswordResetAction,
} from "@/app/(admin)/admin/clients/[id]/access-actions";

type Feedback = { ok: boolean; msg: string } | null;

/**
 * Workspace Access (S4A) — who can sign in to THIS client workspace, and the
 * admin controls to grant (existing user or new invite), revoke, and send a
 * password reset. One person can belong to several workspaces via one login, so
 * granting here never creates a second account or changes anyone's password.
 */
export function WorkspaceAccessCard({
  clientId,
  clientName,
  members,
}: {
  clientId: string;
  clientName: string;
  members: WorkspaceMember[];
}) {
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  function grant() {
    if (!email.trim()) return;
    setFeedback(null);
    setBusy("grant");
    startTransition(async () => {
      const res = await grantWorkspaceAccessAction(clientId, email);
      setBusy(null);
      if (!res.ok) {
        setFeedback({ ok: false, msg: res.error ?? "Could not grant access." });
        return;
      }
      setEmail("");
      const msg =
        res.outcome === "invited"
          ? `Invitation sent to ${res.email}. They'll set their own password and appear here once they accept.`
          : res.outcome === "already_member"
            ? `${res.email} already has access to ${clientName}.`
            : `Access granted to ${res.email}.`;
      setFeedback({ ok: true, msg });
    });
  }

  function revoke(m: WorkspaceMember) {
    const label = m.email ?? m.name ?? "this user";
    if (!window.confirm(`Revoke ${label}'s access to ${clientName}? They keep their account and any access to other workspaces.`)) return;
    setFeedback(null);
    setBusy(`revoke-${m.userId}`);
    startTransition(async () => {
      const res = await revokeWorkspaceAccessAction(clientId, m.userId);
      setBusy(null);
      setFeedback(
        res.ok
          ? { ok: true, msg: res.remaining === 0 ? `Access revoked. ${label} now has no workspaces and will be signed out to a no-access screen.` : `Access to ${clientName} revoked for ${label}.` }
          : { ok: false, msg: res.error ?? "Could not revoke access." }
      );
    });
  }

  function reset(m: WorkspaceMember) {
    if (!m.email) return;
    setFeedback(null);
    setBusy(`reset-${m.userId}`);
    startTransition(async () => {
      const res = await sendMemberPasswordResetAction(clientId, m.email!);
      setBusy(null);
      setFeedback(
        res.ok
          ? { ok: true, msg: `Password-reset email sent to ${m.email}. They choose their own new password.` }
          : { ok: false, msg: res.error ?? "Could not send the reset email." }
      );
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4.5 w-4.5 text-brand-500" />
          <CardTitle>Workspace Access</CardTitle>
        </div>
        <Badge tone="neutral">
          {members.length} {members.length === 1 ? "person" : "people"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-ink-500">
          People who can sign in to <strong>{clientName}</strong>. One person can
          belong to several workspaces with a single login.
        </p>

        {/* Member list */}
        {members.length > 0 ? (
          <ul className="space-y-2">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex flex-col gap-2 rounded-xl border border-ink-100 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink-900">
                      {m.name ?? m.email ?? "Portal user"}
                    </p>
                    {m.isDefault && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-400">
                        <ShieldCheck className="h-3.5 w-3.5" /> Default workspace
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-ink-500">{m.email ?? "—"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {m.status === "active" ? (
                    <Badge tone="success" dot>
                      Access active
                    </Badge>
                  ) : (
                    <Badge tone="warning" dot>
                      <Clock className="mr-1 h-3 w-3" /> Invitation pending
                    </Badge>
                  )}
                  {m.email && (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busy === `reset-${m.userId}`}
                      disabled={pending}
                      onClick={() => reset(m)}
                      title="Send password reset"
                    >
                      <KeyRound className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy === `revoke-${m.userId}`}
                    disabled={pending}
                    onClick={() => revoke(m)}
                    title="Revoke access"
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 rounded-xl bg-ink-50 p-3 text-xs text-ink-500">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            No one has access to this workspace yet. Grant access below.
          </p>
        )}

        {/* Grant */}
        <div className="border-t border-ink-100 pt-4">
          <label className="mb-1.5 block text-xs font-medium text-ink-500">
            Grant portal access
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && grant()}
                placeholder="person@example.com"
                className="h-10 w-full rounded-xl border border-ink-200 bg-white pl-9 pr-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
            </div>
            <Button
              loading={busy === "grant"}
              disabled={pending || !email.trim()}
              onClick={grant}
            >
              <UserPlus className="h-4 w-4" /> Grant access
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-ink-400">
            If they already have a Bbettr login, we add this workspace to their
            account. Otherwise we email them a secure invitation to set up their
            own password — Bbettr never sees or sets it.
          </p>
        </div>

        {feedback && (
          <p
            className={`flex items-start gap-1.5 text-sm ${
              feedback.ok ? "text-emerald-600" : "text-red-600"
            }`}
          >
            {feedback.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            {feedback.msg}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
