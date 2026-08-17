"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendMeetingFollowUpAction } from "@/lib/planner/meetings/actions";
import { FOLLOWUP_TEMPLATES } from "@/lib/planner/meetings/followup-templates";

interface Attendee {
  email: string;
  displayName: string | null;
}

/**
 * Optional post-meeting follow-up composer (0054). Available only on a Completed
 * meeting. The admin explicitly picks recipients (from the meeting's own
 * attendees — none preselected, never guessed), picks a starting template, edits
 * the subject/body, and sends. Delivery is honest per-recipient and never affects
 * the meeting's Completed state. `[First name]` is personalised per recipient on
 * the server.
 */
export function MeetingFollowUpComposer({
  id,
  attendees,
  alreadySent,
}: {
  id: string;
  attendees: Attendee[];
  alreadySent: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [templateKey, setTemplateKey] = useState<string>("thanks");
  const initial = FOLLOWUP_TEMPLATES.find((t) => t.key === "thanks")!;
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { ok: true; warning?: string } | { ok: false; error: string } | null
  >(null);

  function applyTemplate(key: string) {
    setTemplateKey(key);
    const t = FOLLOWUP_TEMPLATES.find((x) => x.key === key);
    if (t) {
      setSubject(t.subject);
      setBody(t.body);
    }
    setResult(null);
  }

  function toggle(email: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
    setResult(null);
  }

  function send() {
    setResult(null);
    startTransition(async () => {
      const res = await sendMeetingFollowUpAction(id, {
        recipientEmails: [...selected],
        subject,
        body,
      });
      if (res.error) setResult({ ok: false, error: res.error });
      else {
        setResult({ ok: true, warning: res.emailWarning });
        router.refresh();
      }
    });
  }

  if (attendees.length === 0) {
    return (
      <p className="text-sm text-ink-500">
        This meeting has no attendees on record, so there&rsquo;s no one to follow up with.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {alreadySent && (
        <p className="flex items-center gap-1.5 text-xs text-ink-500">
          <Check className="h-3.5 w-3.5 text-emerald-600" /> A follow-up has already been sent for this meeting.
        </p>
      )}

      {/* Recipients — explicit, none preselected */}
      <div>
        <p className="mb-2 text-sm font-semibold text-ink-800">Recipients</p>
        <div className="space-y-1.5">
          {attendees.map((a) => (
            <label key={a.email} className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={selected.has(a.email)}
                onChange={() => toggle(a.email)}
                className="h-4 w-4 rounded border-ink-300 text-brand-500 focus:ring-brand-400"
              />
              <span className="font-medium text-ink-900">{a.displayName || a.email}</span>
              {a.displayName && <span className="text-ink-400">· {a.email}</span>}
            </label>
          ))}
        </div>
      </div>

      {/* Template */}
      <div>
        <label htmlFor="fu-template" className="mb-1.5 block text-sm font-semibold text-ink-800">
          Starting template
        </label>
        <select
          id="fu-template"
          value={templateKey}
          onChange={(e) => applyTemplate(e.target.value)}
          className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        >
          {FOLLOWUP_TEMPLATES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Subject */}
      <div>
        <label htmlFor="fu-subject" className="mb-1.5 block text-sm font-semibold text-ink-800">Subject</label>
        <input
          id="fu-subject"
          value={subject}
          onChange={(e) => { setSubject(e.target.value); setResult(null); }}
          className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
      </div>

      {/* Body */}
      <div>
        <label htmlFor="fu-body" className="mb-1.5 block text-sm font-semibold text-ink-800">Message</label>
        <textarea
          id="fu-body"
          value={body}
          onChange={(e) => { setBody(e.target.value); setResult(null); }}
          rows={8}
          className="w-full resize-y rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        <p className="mt-1 text-xs text-ink-400">
          <code>[First name]</code> is personalised for each recipient.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button size="sm" disabled={pending || selected.size === 0} loading={pending} onClick={send}>
          <Send className="h-4 w-4" /> Send follow-up
        </Button>
        {selected.size === 0 && <span className="text-xs text-ink-400">Select at least one recipient.</span>}
      </div>

      {result?.ok && !result.warning && (
        <p className="flex items-center gap-1.5 text-sm text-ink-600">
          <Check className="h-4 w-4 text-emerald-600" /> Follow-up sent.
        </p>
      )}
      {result?.ok && result.warning && (
        <p className="flex items-start gap-1.5 text-sm text-amber-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {result.warning}
        </p>
      )}
      {result && !result.ok && (
        <p className="flex items-start gap-1.5 text-sm text-red-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {result.error}
        </p>
      )}
    </div>
  );
}
