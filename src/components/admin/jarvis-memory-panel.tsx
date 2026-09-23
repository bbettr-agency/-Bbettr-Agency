"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  proposeMemoryAction,
  confirmMemoryAction,
  retireMemoryAction,
  previewClientContextAction,
  type MemoryActionResult,
} from "@/app/(admin)/admin/jarvis/memory-actions";

export interface MemoryRow {
  id: string;
  scope: string;
  category: string;
  state: string;
  current: boolean;
  claim: string;
  importance: number;
  sourceKind: string;
  suppliedDisplay: string | null;
  conflictsWithId: string | null;
}

const SCOPES = ["agency", "client", "user"];
const CATEGORIES = ["company_knowledge", "client_knowledge", "decision", "commitment", "preference_rule", "context_note"];
const SOURCES = ["human_statement", "portal_record", "document", "system_event", "model_inference"];

function stateTone(state: string): "success" | "warning" | "neutral" | "danger" {
  if (state === "confirmed" || state === "observed") return "success";
  if (state === "proposed" || state === "inferred") return "warning";
  if (state === "rejected") return "danger";
  return "neutral";
}

export function JarvisMemoryPanel({
  enabled,
  canPropose,
  canApprove,
  memories,
}: {
  enabled: boolean;
  canPropose: boolean;
  canApprove: boolean;
  memories: MemoryRow[];
}) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<MemoryActionResult | null>(null);
  const [preview, setPreview] = useState<string>("");

  const [scope, setScope] = useState("agency");
  const [category, setCategory] = useState("context_note");
  const [sourceKind, setSourceKind] = useState("human_statement");
  const [claim, setClaim] = useState("");
  const [body, setBody] = useState("");
  const [clientId, setClientId] = useState("");
  const [userId, setUserId] = useState("");
  const [declaredSecret, setDeclaredSecret] = useState(false);
  const [previewClient, setPreviewClient] = useState("");

  if (!enabled) return null;

  function run(key: string, fn: () => Promise<MemoryActionResult>) {
    setBusy(key);
    start(async () => {
      const r = await fn();
      setMsg(r);
      setBusy(null);
    });
  }

  function submitPropose() {
    const fd = new FormData();
    fd.set("scope", scope);
    fd.set("category", category);
    fd.set("sourceKind", sourceKind);
    fd.set("claim", claim);
    fd.set("body", body);
    fd.set("clientId", clientId);
    fd.set("userId", userId);
    if (declaredSecret) fd.set("declaredSecret", "on");
    run("propose", () => proposeMemoryAction(fd));
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Memory (v1)</CardTitle>
        <Badge tone="neutral" dot>
          {memories.length} current
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        {msg && (
          <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>
            {msg.ok ? msg.detail : msg.error}
          </p>
        )}

        {/* Propose / record a memory */}
        {canPropose && (
          <div className="space-y-2 rounded-lg border border-ink-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Record / propose a memory</p>
            <div className="flex flex-wrap gap-2">
              <select value={scope} onChange={(e) => setScope(e.target.value)} className="rounded border border-ink-200 px-2 py-1 text-sm">
                {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded border border-ink-200 px-2 py-1 text-sm">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={sourceKind} onChange={(e) => setSourceKind(e.target.value)} className="rounded border border-ink-200 px-2 py-1 text-sm">
                {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {scope === "client" && (
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="client id (uuid)" className="rounded border border-ink-200 px-2 py-1 text-sm" />
              )}
              {scope === "user" && (
                <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="user id (uuid)" className="rounded border border-ink-200 px-2 py-1 text-sm" />
              )}
            </div>
            <textarea value={claim} onChange={(e) => setClaim(e.target.value)} placeholder="Atomic claim (durable, non-operational)" rows={2} className="w-full rounded border border-ink-200 px-2 py-1 text-sm" />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Optional detail" rows={2} className="w-full rounded border border-ink-200 px-2 py-1 text-sm" />
            <label className="flex items-center gap-2 text-xs text-ink-500">
              <input type="checkbox" checked={declaredSecret} onChange={(e) => setDeclaredSecret(e.target.checked)} /> mark as secret (should be rejected)
            </label>
            <Button size="sm" loading={busy === "propose"} disabled={pending || !claim.trim()} onClick={submitPropose}>
              Record memory
            </Button>
          </div>
        )}

        {/* Current memories */}
        <div className="space-y-2">
          {memories.length === 0 && <p className="text-sm text-ink-400">No current memories.</p>}
          {memories.map((m) => (
            <div key={m.id} className="rounded-lg border border-ink-100 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={stateTone(m.state)}>{m.state}</Badge>
                <span className="text-xs text-ink-400">{m.scope} · {m.category} · imp {m.importance}</span>
                {m.conflictsWithId && <Badge tone="danger">conflict</Badge>}
              </div>
              <p className="mt-1 text-ink-800">{m.claim}</p>
              <p className="mt-0.5 text-xs text-ink-400">
                via {m.sourceKind}{m.suppliedDisplay ? ` · ${m.suppliedDisplay}` : ""}
              </p>
              {canApprove && (
                <div className="mt-2 flex gap-2">
                  {m.state !== "confirmed" && (
                    <Button size="sm" variant="outline" loading={busy === `c-${m.id}`} disabled={pending} onClick={() => run(`c-${m.id}`, () => confirmMemoryAction(m.id))}>
                      Confirm
                    </Button>
                  )}
                  <Button size="sm" variant="outline" loading={busy === `r-${m.id}`} disabled={pending} onClick={() => run(`r-${m.id}`, () => retireMemoryAction(m.id, "retired via admin surface"))}>
                    Retire
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Context preview */}
        <div className="space-y-2 rounded-lg border border-ink-200 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Preview ContextPackage (client)</p>
          <div className="flex gap-2">
            <input value={previewClient} onChange={(e) => setPreviewClient(e.target.value)} placeholder="client id (uuid)" className="flex-1 rounded border border-ink-200 px-2 py-1 text-sm" />
            <Button size="sm" variant="outline" loading={busy === "preview"} disabled={pending || !previewClient.trim()}
              onClick={() => run("preview", async () => { const r = await previewClientContextAction(previewClient); if (r.ok && r.detail) setPreview(r.detail); return r; })}>
              Assemble
            </Button>
          </div>
          {preview && <pre className="max-h-80 overflow-auto rounded bg-ink-950 p-3 text-xs text-ink-100">{preview}</pre>}
        </div>
      </CardContent>
    </Card>
  );
}
