import type { MeetingInvitationMethod, MeetingInvitationStatus } from "@/lib/database.types";

/**
 * Pure, deterministic planning for meeting invitation delivery. No I/O.
 *
 * Two responsibilities:
 *  1. `attendeeFacingSignature` — a stable digest of the ATTENDEE-VISIBLE calendar
 *     representation (summary / start / end / tz / location / Meet URL / visible
 *     description / lifecycle). Internal-only Portal changes are excluded, so they
 *     never bump SEQUENCE.
 *  2. `planInvitations` — given the current attendee set, lifecycle, the current
 *     content signature, and the existing ledger, decide exactly which recipients
 *     get which METHOD at which SEQUENCE. SEQUENCE is monotonic per meeting/UID.
 *     Idempotency by ledger status is handled by the caller (the service), so this
 *     stays a pure function of desired end-state.
 */

export const ICS_UID_DOMAIN = "portal.bbettragency.com";

/** Stable ICS UID for a meeting — never changes across its lifetime. */
export function uidForMeeting(meetingId: string): string {
  return `${meetingId}@${ICS_UID_DOMAIN}`;
}

export interface AttendeeFacingFields {
  summary: string;
  startsAtIso: string;
  endsAtIso: string;
  timeZone: string;
  location: string | null;
  meetUrl: string | null;
  description: string | null;
  /** "active" | "cancelled" — cancellation is itself an attendee-facing change. */
  lifecycle: "active" | "cancelled";
}

/**
 * Deterministic digest of the attendee-visible representation. Same visible event
 * ⇒ same signature ⇒ no SEQUENCE bump. Any attendee-visible property change ⇒ a
 * different signature. Normalises whitespace so incidental formatting does not
 * churn the sequence.
 */
export function attendeeFacingSignature(f: AttendeeFacingFields): string {
  const norm = (s: string | null): string => (s ?? "").replace(/\s+/g, " ").trim();
  const canonical = [
    `summary=${norm(f.summary)}`,
    `start=${new Date(f.startsAtIso).toISOString()}`,
    `end=${new Date(f.endsAtIso).toISOString()}`,
    `tz=${norm(f.timeZone)}`,
    `location=${norm(f.location)}`,
    `meet=${norm(f.meetUrl)}`,
    `description=${norm(f.description)}`,
    `lifecycle=${f.lifecycle}`,
  ].join("\u0001");
  return djb2(canonical);
}

/** Small deterministic string hash (djb2, hex). No crypto dependency needed — this
 *  is a change-detection digest, not a security primitive. */
function djb2(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (h * 33) ^ input.charCodeAt(i);
  // >>> 0 → unsigned; pad for stable width.
  return (h >>> 0).toString(16).padStart(8, "0");
}

export interface LedgerRow {
  attendee_email: string;
  method: MeetingInvitationMethod;
  sequence: number;
  content_signature: string;
  status: MeetingInvitationStatus;
}

export interface PlannedSend {
  email: string;
  method: MeetingInvitationMethod;
  sequence: number;
  contentSignature: string;
}

/**
 * Decide the desired invitations for the current state. Pure: same inputs ⇒ same
 * output. The service reconciles these against actual ledger rows for idempotency
 * (skip already-sent, retry failed, insert missing).
 */
export function planInvitations(args: {
  /** Current attendee emails (any case; normalised here). */
  currentAttendees: string[];
  lifecycle: "active" | "cancelled";
  /** Signature of the current attendee-facing content (active meetings). */
  contentSig: string;
  ledger: LedgerRow[];
}): PlannedSend[] {
  const current = [...new Set(args.currentAttendees.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const currentSet = new Set(current);
  const ledger = args.ledger;

  const maxSeq = ledger.reduce((m, r) => Math.max(m, r.sequence), -1);

  const latestByEmail = new Map<string, LedgerRow>();
  const latestReqByEmail = new Map<string, LedgerRow>();
  for (const r of ledger) {
    const cur = latestByEmail.get(r.attendee_email);
    if (!cur || r.sequence > cur.sequence) latestByEmail.set(r.attendee_email, r);
    if (r.method === "request") {
      const cr = latestReqByEmail.get(r.attendee_email);
      if (!cr || r.sequence > cr.sequence) latestReqByEmail.set(r.attendee_email, r);
    }
  }
  const requestedEmails = [...latestReqByEmail.keys()];

  // The current-content marker = the highest-sequence REQUEST across attendees.
  let topReq: LedgerRow | null = null;
  for (const r of latestReqByEmail.values()) if (!topReq || r.sequence > topReq.sequence) topReq = r;
  const hasAnyReq = topReq !== null;
  const contentChanged = hasAnyReq && topReq!.content_signature !== args.contentSig;
  const contentSeq = !hasAnyReq ? 0 : contentChanged ? maxSeq + 1 : topReq!.sequence;
  const bumpSeq = maxSeq + 1;

  const sends: PlannedSend[] = [];

  if (args.lifecycle === "cancelled") {
    // Cancel every attendee who was ever invited and is not already cancelled.
    for (const email of requestedEmails) {
      if (latestByEmail.get(email)?.method === "cancel") continue;
      sends.push({ email, method: "cancel", sequence: bumpSeq, contentSignature: args.contentSig });
    }
    return dedupe(sends);
  }

  // Active: REQUEST for current attendees at the right sequence.
  for (const email of current) {
    const latest = latestByEmail.get(email);
    const lastReq = latestReqByEmail.get(email);
    let seq: number;
    if (contentChanged) {
      seq = bumpSeq; // event materially changed → everyone updates
    } else if (!latest) {
      seq = contentSeq; // brand-new attendee → current revision
    } else if (latest.method === "cancel") {
      seq = bumpSeq; // re-added → supersede their earlier cancel
    } else {
      // Existing attendee, content unchanged. Skip if they already hold the current
      // revision (delivered/sent/bounced/complained); retry only if their last send
      // failed or is still queued (a crash before dispatch).
      const holdsCurrent =
        !!lastReq &&
        lastReq.content_signature === args.contentSig &&
        latest.method === "request" &&
        isTerminalSent(latest.status);
      if (holdsCurrent) continue;
      seq = contentSeq;
    }
    sends.push({ email, method: "request", sequence: seq, contentSignature: args.contentSig });
  }

  // Removed attendees (were invited, no longer current) → CANCEL.
  for (const email of requestedEmails) {
    if (currentSet.has(email)) continue;
    if (latestByEmail.get(email)?.method === "cancel") continue;
    sends.push({ email, method: "cancel", sequence: bumpSeq, contentSignature: args.contentSig });
  }

  return dedupe(sends);
}

function isTerminalSent(status: MeetingInvitationStatus): boolean {
  return status === "sent" || status === "delivered" || status === "complained" || status === "bounced";
}

function dedupe(sends: PlannedSend[]): PlannedSend[] {
  const seen = new Set<string>();
  const out: PlannedSend[] = [];
  for (const s of sends) {
    const k = `${s.email}|${s.method}|${s.sequence}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}
