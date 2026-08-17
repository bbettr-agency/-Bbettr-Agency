import { describe, it, expect, beforeEach, vi } from "vitest";

// 0054 application-layer control flow: mark/undo attended, notes, follow-up, and
// the guards added to mark-no-show / manual reschedule. The DB proof (tasks-0054)
// owns the SQL guarantees; these own the ACTION behaviour — token retirement,
// Google inertness (no reconcile), recipient safety, and honest delivery.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ id: "admin", role: "admin" })) }));
vi.mock("@/lib/flags", () => ({ isPlannerEnabled: vi.fn(() => true) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/planner/scheduling/service", () => ({ reconcileMeeting: vi.fn(async () => ({ result: "success" })) }));
vi.mock("@/lib/email/meeting-notifications", () => ({
  sendMeetingConfirmationEmail: vi.fn(async () => ({ ok: true })),
  sendNoShowFollowUpEmail: vi.fn(async () => ({ ok: true })),
  sendMeetingFollowUpEmail: vi.fn(async () => ({ ok: true })),
}));

import {
  markAttendedAction,
  undoAttendedAction,
  saveMeetingOutcomeNotesAction,
  sendMeetingFollowUpAction,
  markNoShowAction,
  updateMeetingAction,
} from "./actions";
import { createClient } from "@/lib/supabase/server";
import { reconcileMeeting } from "@/lib/planner/scheduling/service";
import { sendMeetingFollowUpEmail } from "@/lib/email/meeting-notifications";
import type { MeetingInput } from "./types";

const MID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** Records update payloads + every filter call per table; routes maybeSingle/await results. */
function makeClient(cfg: Record<string, { single?: unknown; settle?: unknown }>) {
  const calls: Record<string, unknown[][]> = {};
  const updates: Record<string, Record<string, unknown>[]> = {};
  const builders: Record<string, unknown> = {};
  const mk = (table: string, tc: { single?: unknown; settle?: unknown }) => {
    const rec = (m: string, a: unknown[]) => ((calls[table] ??= []).push([m, ...a]));
    const b: Record<string, unknown> = {
      update: (p: Record<string, unknown>) => { (updates[table] ??= []).push(p); rec("update", [p]); return b; },
      insert: (p: unknown) => (rec("insert", [p]), b),
      delete: () => (rec("delete", []), b),
      select: (...a: unknown[]) => (rec("select", a), b),
      eq: (...a: unknown[]) => (rec("eq", a), b),
      is: (...a: unknown[]) => (rec("is", a), b),
      lte: (...a: unknown[]) => (rec("lte", a), b),
      neq: (...a: unknown[]) => (rec("neq", a), b),
      gt: (...a: unknown[]) => (rec("gt", a), b),
      lt: (...a: unknown[]) => (rec("lt", a), b),
      maybeSingle: async () => tc.single ?? { data: null, error: null },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(tc.settle ?? { data: null, error: null }).then(res, rej),
    };
    return b;
  };
  const client = { from: (t: string) => (builders[t] ??= mk(t, cfg[t] ?? {})) };
  vi.mocked(createClient).mockResolvedValue(client as never);
  return { calls, updates };
}
const flat = (calls: Record<string, unknown[][]>, table: string) => JSON.stringify(calls[table] ?? []);

const validInput = (over: Partial<MeetingInput> = {}): MeetingInput => ({
  title: "Sync", description: null,
  startsAt: "2026-09-01T09:00:00Z", endsAt: "2026-09-01T10:00:00Z",
  timeZone: "Africa/Johannesburg", hasMeet: false, attendees: [], ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sendMeetingFollowUpEmail).mockResolvedValue({ ok: true });
});

describe("markAttendedAction", () => {
  it("sets attended_at, retires the token, and is INERT to Google (no reconcile)", async () => {
    const { calls, updates } = makeClient({ meetings: { single: { data: { id: MID }, error: null } } });
    const res = await markAttendedAction(MID);
    expect(res).toEqual({ ok: true, id: MID });
    const payload = updates.meetings[0];
    expect(payload.attended_at).toBeTypeOf("string");
    expect(payload.reschedule_token_hash).toBeNull();
    expect(payload.reschedule_token_expires_at).toBeNull();
    expect(reconcileMeeting).not.toHaveBeenCalled();
    // Guards present in the WHERE clause (stale UI rejects cleanly, never hits the CHECK).
    const f = flat(calls, "meetings");
    expect(f).toContain('["lte","ends_at"');
    expect(f).toContain('["is","no_show_at",null]');
    expect(f).toContain('["is","attended_at",null]');
    expect(f).toContain('["eq","status","scheduled"]');
  });

  it("rejects cleanly when no row matches (future / cancelled / deleted / no-show / already-attended)", async () => {
    const { calls } = makeClient({ meetings: { single: { data: null, error: null } } });
    const res = await markAttendedAction(MID);
    expect(res.error).toMatch(/can't be marked attended/i);
    expect(res.ok).toBeUndefined();
    expect(flat(calls, "meetings")).toContain('["lte","ends_at"'); // future guard is in the query
    expect(reconcileMeeting).not.toHaveBeenCalled();
  });
});

describe("undoAttendedAction", () => {
  it("clears attended_at only, no email, no Google", async () => {
    const { updates } = makeClient({ meetings: { settle: { error: null } } });
    const res = await undoAttendedAction(MID);
    expect(res).toEqual({ ok: true, id: MID });
    expect(updates.meetings[0]).toEqual({ attended_at: null });
    expect(reconcileMeeting).not.toHaveBeenCalled();
  });
});

describe("markNoShowAction — attended guard", () => {
  it("rejects an already-completed meeting cleanly (query guards attended_at IS NULL)", async () => {
    const { calls } = makeClient({ meetings: { single: { data: null, error: null } } });
    const res = await markNoShowAction(MID);
    expect(res.error).toMatch(/already has a recorded outcome|isn't scheduled/i);
    expect(flat(calls, "meetings")).toContain('["is","attended_at",null]');
    expect(reconcileMeeting).not.toHaveBeenCalled();
  });
});

describe("updateMeetingAction — completion clearing", () => {
  it("a TIME change clears attended_at (alongside no_show + token)", async () => {
    const { updates } = makeClient({
      meetings: { single: { data: { starts_at: "2026-09-01T09:00:00Z", ends_at: "2026-09-01T10:00:00Z" }, error: null }, settle: { error: null } },
      meeting_attendees: { settle: { error: null } },
    });
    await updateMeetingAction(MID, validInput({ startsAt: "2026-09-08T09:00:00Z", endsAt: "2026-09-08T10:00:00Z" }));
    const payload = updates.meetings[0];
    expect(payload.attended_at).toBeNull();
    expect(payload.no_show_at).toBeNull();
    expect(payload.reschedule_token_hash).toBeNull();
  });

  it("a metadata-only edit (same time) preserves attended_at", async () => {
    const { updates } = makeClient({
      meetings: { single: { data: { starts_at: "2026-09-01T09:00:00Z", ends_at: "2026-09-01T10:00:00Z" }, error: null }, settle: { error: null } },
      meeting_attendees: { settle: { error: null } },
    });
    await updateMeetingAction(MID, validInput({ title: "Renamed" }));
    expect("attended_at" in updates.meetings[0]).toBe(false);
  });
});

describe("saveMeetingOutcomeNotesAction", () => {
  it("accepts <= 4000 chars, no email, no Google", async () => {
    const { updates } = makeClient({ meetings: { settle: { error: null } } });
    const res = await saveMeetingOutcomeNotesAction(MID, "a".repeat(4000));
    expect(res).toEqual({ ok: true, id: MID });
    expect((updates.meetings[0].outcome_notes as string).length).toBe(4000);
    expect(reconcileMeeting).not.toHaveBeenCalled();
  });

  it("rejects > 4000 chars BEFORE any DB write", async () => {
    const res = await saveMeetingOutcomeNotesAction(MID, "a".repeat(4001));
    expect(res.error).toMatch(/4000 characters/i);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("empty/whitespace clears the field to null", async () => {
    const { updates } = makeClient({ meetings: { settle: { error: null } } });
    await saveMeetingOutcomeNotesAction(MID, "   ");
    expect(updates.meetings[0].outcome_notes).toBeNull();
  });
});

describe("sendMeetingFollowUpAction", () => {
  const completed = { id: MID, status: "scheduled", attended_at: "2026-09-01T10:05:00Z", no_show_at: null, thank_you_sent_at: null };
  const twoAttendees = { settle: { data: [{ email: "a@x.com", display_name: "Ann Smith" }, { email: "b@x.com", display_name: "Bob" }], error: null } };
  const send = (over: Record<string, unknown> = {}) =>
    sendMeetingFollowUpAction(MID, { recipientEmails: ["a@x.com", "b@x.com"], subject: "Thanks [First name]", body: "Hi [First name],\n\nGreat meeting.", ...over });

  it("only Completed meetings", async () => {
    makeClient({ meetings: { single: { data: { ...completed, attended_at: null }, error: null } } });
    const res = await send();
    expect(res.error).toMatch(/only available once a meeting is marked attended/i);
    expect(sendMeetingFollowUpEmail).not.toHaveBeenCalled();
  });

  it("intersects recipients with stored attendees — arbitrary address never emailed", async () => {
    makeClient({ meetings: { single: { data: completed, error: null } }, meeting_attendees: twoAttendees });
    await sendMeetingFollowUpAction(MID, { recipientEmails: ["a@x.com", "evil@attacker.com"], subject: "Hi", body: "Body" });
    expect(sendMeetingFollowUpEmail).toHaveBeenCalledTimes(1);
    expect((vi.mocked(sendMeetingFollowUpEmail).mock.calls[0][0] as { to: string }).to).toBe("a@x.com");
  });

  it("rejects a selection that is only arbitrary addresses", async () => {
    makeClient({ meetings: { single: { data: completed, error: null } }, meeting_attendees: twoAttendees });
    const res = await sendMeetingFollowUpAction(MID, { recipientEmails: ["evil@attacker.com"], subject: "Hi", body: "Body" });
    expect(res.error).toMatch(/select at least one/i);
    expect(sendMeetingFollowUpEmail).not.toHaveBeenCalled();
  });

  it("rejects an empty recipient selection", async () => {
    makeClient({ meetings: { single: { data: completed, error: null } }, meeting_attendees: twoAttendees });
    const res = await sendMeetingFollowUpAction(MID, { recipientEmails: [], subject: "Hi", body: "Body" });
    expect(res.error).toMatch(/select at least one/i);
  });

  it("personalises [First name] per recipient from the edited subject/body", async () => {
    makeClient({ meetings: { single: { data: completed, error: null } }, meeting_attendees: twoAttendees });
    await send();
    const arg = vi.mocked(sendMeetingFollowUpEmail).mock.calls[0][0] as { subject: string; body: string };
    expect(arg.subject).toBe("Thanks Ann"); // first token of "Ann Smith"
    expect(arg.body).toContain("Hi Ann,");
  });

  it("all success → emailSent true, stamps thank_you_sent_at once", async () => {
    const { updates } = makeClient({ meetings: { single: { data: completed, error: null } }, meeting_attendees: twoAttendees });
    const res = await send();
    expect(res.emailSent).toBe(true);
    expect(updates.meetings.some((u) => "thank_you_sent_at" in u)).toBe(true);
  });

  it("PARTIAL failure → honest warning + failedRecipients, completion NEVER touched", async () => {
    vi.mocked(sendMeetingFollowUpEmail).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: "bounce" });
    const { updates } = makeClient({ meetings: { single: { data: completed, error: null } }, meeting_attendees: twoAttendees });
    const res = await send();
    expect(res.emailSent).toBe(false);
    expect(res.failedRecipients).toEqual(["b@x.com"]);
    expect(res.emailWarning).toContain("b@x.com");
    // still stamped (>=1 sent), and NOTHING wrote attended_at.
    expect(updates.meetings.every((u) => !("attended_at" in u))).toBe(true);
  });

  it("TOTAL failure → emailSent false, NOT stamped, completion NEVER touched", async () => {
    vi.mocked(sendMeetingFollowUpEmail).mockResolvedValue({ ok: false, error: "no key" });
    const { updates } = makeClient({ meetings: { single: { data: completed, error: null } }, meeting_attendees: twoAttendees });
    const res = await send();
    expect(res.emailSent).toBe(false);
    expect(res.failedRecipients?.length).toBe(2);
    expect((updates.meetings ?? []).some((u) => "thank_you_sent_at" in u)).toBe(false);
    expect((updates.meetings ?? []).every((u) => !("attended_at" in u))).toBe(true);
  });

  it("preserves an existing thank_you_sent_at on resend (stamp once)", async () => {
    const { updates } = makeClient({
      meetings: { single: { data: { ...completed, thank_you_sent_at: "2026-09-01T11:00:00Z" }, error: null } },
      meeting_attendees: twoAttendees,
    });
    const res = await send();
    expect(res.emailSent).toBe(true);
    expect((updates.meetings ?? []).some((u) => "thank_you_sent_at" in u)).toBe(false); // preserved
  });
});
