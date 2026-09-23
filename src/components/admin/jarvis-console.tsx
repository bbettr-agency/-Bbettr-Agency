"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, AlertCircle, ShieldCheck, Play, KeyRound, Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  assignJarvisGrantAction,
  invokeCapabilityAction,
  approveProposalAction,
  rejectProposalAction,
} from "@/app/(admin)/admin/jarvis/actions";
import type { JarvisActionRow } from "@/lib/jarvis/audit";

type Fb = { ok: boolean; msg: string } | null;
interface Cap { id: string; title: string; riskClass: string; requiredGrant: string }
interface Prop { id: string; capabilityId: string; rationale: string | null; createdAt: string; expiresAt: string }

/**
 * Foundation 1 admin console — the MINIMAL surface to inspect/exercise the Jarvis
 * security kernel (bootstrap grants, invoke a capability through the full policy
 * path, approve/reject proposals, view the audit). Not the final Jarvis UI.
 */
export function JarvisConsole({
  enabled,
  canApprove,
  capabilities,
  proposals,
  actions,
}: {
  enabled: boolean;
  canApprove: boolean;
  capabilities: Cap[];
  proposals: Prop[];
  actions: JarvisActionRow[];
}) {
  const [pending, start] = useTransition();
  const [fb, setFb] = useState<Fb>(null);
  const [email, setEmail] = useState("");
  const [bundle, setBundle] = useState("bundle:founder");
  const [capId, setCapId] = useState(capabilities[0]?.id ?? "");
  const [args, setArgs] = useState("{}");
  const [busy, setBusy] = useState<string | null>(null);

  const run = (key: string, fn: () => Promise<{ ok: boolean; error?: string; detail?: string }>) => {
    setFb(null);
    setBusy(key);
    start(async () => {
      const r = await fn();
      setBusy(null);
      setFb({ ok: r.ok, msg: r.ok ? r.detail ?? "Done." : r.error ?? "Failed." });
    });
  };

  return (
    <div className="space-y-6">
      {/* Grants / bootstrap */}
      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <KeyRound className="h-4.5 w-4.5 text-brand-500" />
          <CardTitle>Capability grants</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-ink-500">
            Assign a Jarvis bundle to a portal user by email. Grants are data (never hardcoded); default-deny.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@example.com"
              className="h-10 flex-1 rounded-xl border border-ink-200 px-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
            <select value={bundle} onChange={(e) => setBundle(e.target.value)}
              className="h-10 rounded-xl border border-ink-200 px-3 text-sm">
              <option value="bundle:founder">Founder bundle</option>
              <option value="bundle:readonly_staff">Read-only staff bundle</option>
            </select>
            <Button loading={busy === "grant"} disabled={pending || !email.trim()}
              onClick={() => run("grant", () => assignJarvisGrantAction(email, bundle))}>
              <ShieldCheck className="h-4 w-4" /> Assign
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Invoke capability (test surface) */}
      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <Play className="h-4.5 w-4.5 text-brand-500" />
          <CardTitle>Invoke capability</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select value={capId} onChange={(e) => setCapId(e.target.value)}
              className="h-10 flex-1 rounded-xl border border-ink-200 px-3 text-sm">
              {capabilities.map((c) => (
                <option key={c.id} value={c.id}>{c.title} — {c.id} [{c.riskClass}]</option>
              ))}
            </select>
            <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder='{"title":"…"}'
              className="h-10 flex-1 rounded-xl border border-ink-200 px-3 font-mono text-xs focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100" />
            <Button variant="outline" loading={busy === "invoke"} disabled={pending || !enabled || !capId}
              onClick={() => run("invoke", () => invokeCapabilityAction(capId, args))}>
              Invoke
            </Button>
          </div>
          {!enabled && <p className="text-xs text-amber-600">You need the jarvis.use grant to invoke capabilities.</p>}
        </CardContent>
      </Card>

      {/* Pending approvals */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Needs approval</CardTitle>
          <Badge tone="neutral">{proposals.length}</Badge>
        </CardHeader>
        <CardContent className="space-y-2">
          {proposals.length === 0 ? (
            <p className="text-sm text-ink-400">No pending proposals.</p>
          ) : (
            proposals.map((p) => (
              <div key={p.id} className="flex flex-col gap-2 rounded-xl border border-ink-100 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900">{p.capabilityId}</p>
                  <p className="truncate text-xs text-ink-500">{p.rationale ?? "—"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" disabled={pending || !canApprove} loading={busy === `a-${p.id}`}
                    onClick={() => run(`a-${p.id}`, () => approveProposalAction(p.id))}>
                    <Check className="h-4 w-4" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={pending || !canApprove} loading={busy === `r-${p.id}`}
                    onClick={() => run(`r-${p.id}`, () => rejectProposalAction(p.id))}>
                    <X className="h-4 w-4" /> Reject
                  </Button>
                </div>
              </div>
            ))
          )}
          {!canApprove && proposals.length > 0 && (
            <p className="text-xs text-amber-600">You lack the jarvis.approve grant, so you can view but not approve.</p>
          )}
        </CardContent>
      </Card>

      {/* Audit */}
      <Card>
        <CardHeader><CardTitle>Recent Jarvis actions</CardTitle></CardHeader>
        <CardContent className="divide-y divide-ink-100 p-0">
          {actions.length === 0 ? (
            <p className="p-4 text-sm text-ink-400">No actions yet.</p>
          ) : (
            actions.map((a) => (
              <div key={a.event_id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-40 shrink-0 truncate font-mono text-xs text-ink-500">{a.capability_id}</span>
                <Badge tone={a.decision === "allow" ? "success" : a.decision === "deny" ? "danger" : "neutral"}>
                  {a.decision}
                </Badge>
                <span className="text-xs text-ink-400">
                  {a.executed ? (a.success ? "executed" : "failed") : "—"}
                  {a.verification_state ? ` · ${a.verification_state}` : ""}
                </span>
                <span className="ml-auto text-xs text-ink-400">{new Date(a.occurred_at).toLocaleString()}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {fb && (
        <p className={`flex items-center gap-1.5 text-sm ${fb.ok ? "text-emerald-600" : "text-red-600"}`}>
          {fb.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />} {fb.msg}
        </p>
      )}
    </div>
  );
}
