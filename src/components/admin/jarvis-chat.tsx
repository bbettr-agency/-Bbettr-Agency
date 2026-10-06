"use client";

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Plus, AlertCircle, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MarkdownMessage } from "./markdown-message";
import { approveProposalAction, rejectProposalAction } from "@/app/(admin)/admin/jarvis/actions";
import {
  newSubmission,
  toRequestBody,
  adoptThreadId,
  mapResponse,
  errorCopy,
  MESSAGE_MAX_CHARS,
  type Submission,
  type TurnResponse,
} from "./jarvis-chat-turn";

/**
 * Jarvis Chat (F3) — the founder-facing conversational surface at /admin/jarvis.
 * Frontend only: it uses the existing authenticated /api/jarvis/chat transport and the
 * existing approve/reject server actions. It never holds provider/service-role
 * credentials, never calls a provider directly, never fabricates a successful assistant
 * message, and never shows a proposal executed until the trusted server action confirms.
 * All correctness-critical logic (fresh-key-per-submission, exact retry replay, thread
 * adoption, DTO→view mapping) is in ./jarvis-chat-turn (unit-tested).
 */

type UserItem = { id: string; role: "user"; text: string };
type JarvisItem = { id: string; role: "jarvis"; sub: Submission; state: "sending" | "done" | "processing" | "error"; response?: TurnResponse };
type Item = UserItem | JarvisItem;

function timeGreeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function JarvisChat({ firstName }: { firstName?: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [sessionThreadId, setSessionThreadId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [greeting, setGreeting] = useState("Hello");

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true); // whether to keep pinned to the bottom
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setGreeting(timeGreeting()), []);

  // Auto-scroll only when the user is already near the bottom (or just sent).
  useEffect(() => {
    if (stickRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  const runSubmission = useCallback(async (itemId: string, sub: Submission) => {
    setSending(true);
    setItems((prev) => prev.map((it) => (it.id === itemId && it.role === "jarvis" ? { ...it, state: "sending" } : it)));
    let mapped: TurnResponse;
    try {
      const res = await fetch("/api/jarvis/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toRequestBody(sub)),
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      mapped = mapResponse(res.status, body, res.headers.get("retry-after"));
    } catch {
      const c = errorCopy("network");
      mapped = { kind: "error", code: "network", message: c.message, retryable: c.retryable };
    }
    if (mapped.kind === "completed" && mapped.threadId) {
      setSessionThreadId((cur) => adoptThreadId(cur, mapped.threadId));
    }
    setItems((prev) =>
      prev.map((it) =>
        it.id === itemId && it.role === "jarvis"
          ? { ...it, state: mapped.kind === "completed" ? "done" : mapped.kind, response: mapped }
          : it
      )
    );
    setSending(false);
  }, []);

  const send = useCallback(() => {
    const text = input.trim();
    if (sending || text.length === 0 || text.length > MESSAGE_MAX_CHARS) return;
    const sub = newSubmission(text, sessionThreadId);
    const userId = crypto.randomUUID();
    const jarvisId = crypto.randomUUID();
    stickRef.current = true;
    setItems((prev) => [...prev, { id: userId, role: "user", text: sub.message }, { id: jarvisId, role: "jarvis", sub, state: "sending" }]);
    setInput("");
    void runSubmission(jarvisId, sub);
    composerRef.current?.focus();
  }, [input, sending, sessionThreadId, runSubmission]);

  const newChat = useCallback(() => {
    if (sending) return;
    setItems([]);
    setSessionThreadId(undefined);
    setInput("");
    stickRef.current = true;
    composerRef.current?.focus();
  }, [sending]);

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const empty = items.length === 0;

  return (
    <div className="flex min-h-[60vh] flex-col">
      {/* Screen-reader operational status (never the full conversation). */}
      <div className="sr-only" role="status" aria-live="polite">
        {sending ? "Jarvis is responding" : ""}
      </div>

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
          <div className="mb-3 inline-flex items-center gap-2 text-brand-600">
            <Sparkles className="h-5 w-5" aria-hidden />
            <span className="font-display text-lg font-semibold tracking-wide text-ink-900">JARVIS</span>
          </div>
          <h2 className="text-xl font-semibold text-ink-900 sm:text-2xl">
            {greeting}
            {firstName ? `, ${firstName}` : ""}.
          </h2>
          <p className="mt-1 text-ink-500">What can I help you with?</p>
          <div className="mt-6 w-full max-w-2xl">
            <Composer
              ref={composerRef}
              value={input}
              onChange={setInput}
              onKeyDown={onComposerKeyDown}
              onSend={send}
              sending={sending}
              autoFocus
            />
          </div>
        </div>
      ) : (
        <>
          <div className="mx-auto mb-3 flex w-full max-w-2xl items-center justify-end">
            <Button variant="ghost" size="sm" onClick={newChat} disabled={sending}>
              <Plus className="h-4 w-4" aria-hidden /> New chat
            </Button>
          </div>
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="flex-1 space-y-6 overflow-y-auto pb-4"
            role="log"
            aria-label="Jarvis conversation"
          >
            <div className="mx-auto flex max-w-2xl flex-col gap-6">
              {items.map((it) =>
                it.role === "user" ? (
                  <UserBubble key={it.id} text={it.text} />
                ) : (
                  <JarvisTurnView key={it.id} item={it} onRetry={() => !sending && runSubmission(it.id, it.sub)} />
                )
              )}
            </div>
          </div>
          <div className="sticky bottom-0 mt-2 bg-ink-50/85 pt-2 backdrop-blur-lg">
            <div className="mx-auto max-w-2xl">
              <Composer ref={composerRef} value={input} onChange={setInput} onKeyDown={onComposerKeyDown} onSend={send} sending={sending} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Composer ─────────────────────────────────────────────────────────────────
interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  sending: boolean;
  autoFocus?: boolean;
}
const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer(
  { value, onChange, onKeyDown, onSend, sending, autoFocus },
  ref
) {
  const canSend = !sending && value.trim().length > 0 && value.length <= MESSAGE_MAX_CHARS;
  return (
    <div className="relative">
      <label htmlFor="jarvis-composer" className="sr-only">
        Message Jarvis
      </label>
      <Textarea
        id="jarvis-composer"
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Message Jarvis…"
        maxLength={MESSAGE_MAX_CHARS}
        autoFocus={autoFocus}
        rows={2}
        className="max-h-56 pr-14"
      />
      <Button
        type="button"
        size="icon"
        onClick={onSend}
        disabled={!canSend}
        aria-label={sending ? "Sending" : "Send message"}
        className="absolute bottom-2.5 right-2.5 h-9 w-9 rounded-lg"
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowUp className="h-4 w-4" aria-hidden />}
      </Button>
    </div>
  );
});

// ── Messages ─────────────────────────────────────────────────────────────────
function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-ink-100 px-4 py-2.5 text-sm text-ink-900">{text}</div>
    </div>
  );
}

function JarvisTurnView({ item, onRetry }: { item: JarvisItem; onRetry: () => void }) {
  if (item.state === "sending") {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-400" aria-hidden>
        <Loader2 className="h-4 w-4 animate-spin" /> Jarvis is thinking…
      </div>
    );
  }
  const r = item.response;
  if (!r) return null;

  if (r.kind === "processing") {
    return (
      <TurnNotice tone="muted">
        Still working on your last message.{" "}
        <button className="font-medium text-brand-600 hover:underline" onClick={onRetry}>
          Check again
        </button>
      </TurnNotice>
    );
  }
  if (r.kind === "error") {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50/60 px-4 py-3 text-sm text-red-700">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <span>
              {r.message}
              {r.retryAfterSeconds ? ` (${r.retryAfterSeconds}s)` : ""}
            </span>
            {r.retryable && (
              <div className="mt-1.5">
                <button className="font-medium text-red-700 underline hover:no-underline" onClick={onRetry}>
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // completed
  return (
    <div className="space-y-3">
      <MarkdownMessage text={r.assistantMessage} className="text-[15px] leading-relaxed text-ink-900" />
      {r.uncertainty && (
        <p className="text-xs text-ink-400">
          Confidence: {r.uncertainty.level}
          {r.uncertainty.notes ? ` — ${r.uncertainty.notes}` : ""}
        </p>
      )}
      {r.action?.status === "approval_required" && r.action.proposalId && (
        <PendingActionCard proposalId={r.action.proposalId} capabilityId={r.action.capabilityId} />
      )}
      {r.memory?.status === "needs_confirmation" && (
        <TurnNotice tone="muted">Memory suggestion pending confirmation — manage it in the Console tab.</TurnNotice>
      )}
    </div>
  );
}

function TurnNotice({ tone, children }: { tone: "muted"; children: React.ReactNode }) {
  return <div className={cn("rounded-xl border px-3.5 py-2 text-sm", tone === "muted" && "border-ink-200 bg-ink-50 text-ink-600")}>{children}</div>;
}

// ── Proposed action card (uses the EXISTING authoritative server actions) ──────
function PendingActionCard({ proposalId, capabilityId }: { proposalId: string; capabilityId?: string }) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [result, setResult] = useState<{ ok: true; label: string } | { ok: false; error: string } | null>(null);

  const isTask = capabilityId === "portal.propose_internal_task";
  const title = isTask ? "Create internal task" : "Proposed action";
  const note = isTask ? "This will create a task in the Planner Inbox." : "Trusted code will re-check and execute this if you approve.";

  async function run(kind: "approve" | "reject") {
    if (busy || result) return;
    setBusy(kind);
    const res = kind === "approve" ? await approveProposalAction(proposalId) : await rejectProposalAction(proposalId);
    setBusy(null);
    if (res.ok) setResult({ ok: true, label: kind === "approve" ? (isTask ? "Task created." : "Approved.") : "Rejected." });
    else setResult({ ok: false, error: res.error ?? "That couldn't be completed." });
  }

  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Proposed action</p>
      <p className="mt-0.5 text-sm font-semibold text-ink-900">{title}</p>
      <p className="mt-1 text-sm text-ink-500">{note}</p>
      {result ? (
        result.ok ? (
          <p className="mt-3 text-sm font-medium text-green-700">{result.label}</p>
        ) : (
          <p className="mt-3 text-sm font-medium text-red-700">Couldn&apos;t complete: {result.error}</p>
        )
      ) : (
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => run("reject")} disabled={busy !== null} loading={busy === "reject"}>
            Reject
          </Button>
          <Button size="sm" onClick={() => run("approve")} disabled={busy !== null} loading={busy === "approve"}>
            {isTask ? "Approve & Create Task" : "Approve"}
          </Button>
        </div>
      )}
    </div>
  );
}
