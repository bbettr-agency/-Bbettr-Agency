import { describe, it, expect, beforeEach, vi } from "vitest";

// Slice C no-show + reschedule-invalidation control flow. The DB proof
// (test:tasks-0053) owns the SQL guarantees; these tests own the ACTION
// behaviour the DB can't see: that marking a no-show is INERT to Google
// (no reconcile), that follow-up delivery is honestly reported and stamped
// once, and that reschedule/cancel/delete write the token/no-show invalidations.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ id: "admin-uid", role: "admin" })) }));
vi.mock("@/lib/flags", () => ({ isPlannerEnabled: vi.fn(() => true) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/planner/scheduling/service", () => ({ reconcileMeeting: vi.fn(async () => ({ result: "success" })) }));
vi.mock("@/lib/email/meeting-notifications", () => ({
  sendMeetingConfirmationEmail: vi.fn(async () => ({ ok: true })),
  sendNoShowFollowUpEmail: vi.fn(async () => ({ ok: true })),
}));

import {
  markNoShowAction,
  unmarkNoShowAction,
  sendNoShowFollowUpAction,
  updateMeetingAction,
  cancelMeetingAction,
} from "./actions";
import { createClient } from "@/lib/supabase/server";
import { reconcileMeeting } from "@/lib/planner/scheduling/service";
import { sendNoShowFollowUpEmail } from "@/lib/email/meeting-notifications";
import type { MeetingInput } from "./types";

const MID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/**
 * Minimal chainable Supabase mock. Every builder method returns the same builder
 * (so any chain length works); `await`ing it resolves to `settle`, and
 * `.maybeSingle()` resolves to `single`. Update/insert/delete payloads are
 * recorded into `cfg.rec` for assertions. One memoised builder per table.
 */
function makeBuilder(cfg: Record<string, unknown>) {
  const rec = (cfg.rec as Record<string, unknown>) ?? {};
  const b: Record<string, unknown> = {
    update(p: unknown) { rec.update = p; return b; },
    insert(p: unknown) { rec.insert = p; return b; },
    delete() { rec.deleted = true; return b; },
    select() { return b; },
    eq() { return b; },
    is() { return b; },
    in() { return b; },
    order() { return b; },
    maybeSingle: async () => cfg.single ?? { data: null, error: null },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      return Promise.resolve(cfg.settle ?? { data: null, error: null }).then(res, rej);
    },
  };
  return b;
}
function makeClient(cfg: Record<string, Record<string, unknown>>) {
  const builders: Record<string, unknown> = {};
  return {
    from(table: string) { return (builders[table] ??= makeBuilder(cfg[table] ?? {})); },
    rpc: cfg.rpc ?? vi.fn(async () => ({ data: null, error: null })),
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

const validInput = (over: Partial<MeetingInput> = {}): MeetingInput => ({
  title: "Client kickoff",
  description: null,
  startsAt: "2026-09-01T09:00:00Z",
  endsAt: "2026-09-01T10:00:00Z",
  timeZone: "Africa/Johannesburg",
  hasMeet: false,
  attendees: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks resets call history but NOT implementations set via
  // mockResolvedValue — restore the default happy-path send each test.
  vi.mocked(sendNoShowFollowUpEmail).mockResolvedValue({ ok: true });
});

describe("markNoShowAction", () => {
  it("stamps no_show_at and is INERT to Google (never reconciles)", async () => {
    const rec: Record<string, unknown> = {};
    vi.mocked(createClient).mockResolvedValue(
      makeClient({ meetings: { rec, single: { data: { id: MID }, error: null } } })
    );
    const res = await markNoShowAction(MID);
    expect(res).toEqual({ ok: true, id: MID });
    expect((rec.update as Record<string, unknown>).no_show_at).toBeTypeOf("string");
    expect(reconcileMeeting).not.toHaveBeenCalled(); // the whole point: no Google write
  });

  it("errors when the meeting is not a scheduled/live row (no matching update)", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeClient({ meetings: { single: { data: null, error: null } } })
    );
    const res = await markNoShowAction(MID);
    expect(res.error).toMatch(/not.*scheduled/i);
    expect(reconcileMeeting).not.toHaveBeenCalled();
  });
});

describe("unmarkNoShowAction", () => {
  it("clears no_show_at, inert to Google", async () => {
    const rec: Record<string, unknown> = {};
    vi.mocked(createClient).mockResolvedValue(
      makeClient({ meetings: { rec, settle: { error: null } } })
    );
    const res = await unmarkNoShowAction(MID);
    expect(res).toEqual({ ok: true, id: MID });
    expect((rec.update as Record<string, unknown>).no_show_at).toBeNull();
    expect(reconcileMeeting).not.toHaveBeenCalled();
  });
});

describe("sendNoShowFollowUpAction", () => {
  const meeting = {
    id: MID, title: "Kickoff", starts_at: "2026-09-01T09:00:00Z", ends_at: "2026-09-01T10:00:00Z",
    time_zone: "Africa/Johannesburg", no_show_at: "2026-09-01T10:05:00Z", no_show_followup_sent_at: null,
  };

  it("requires the meeting to be a no-show first", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeClient({ meetings: { single: { data: { ...meeting, no_show_at: null }, error: null } } })
    );
    const res = await sendNoShowFollowUpAction(MID);
    expect(res.error).toMatch(/mark the meeting as a no-show/i);
    expect(sendNoShowFollowUpEmail).not.toHaveBeenCalled();
  });

  it("errors when there are no attendees to follow up with", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeClient({ meetings: { single: { data: meeting, error: null } }, meeting_attendees: { settle: { data: [], error: null } } })
    );
    const res = await sendNoShowFollowUpAction(MID);
    expect(res.error).toMatch(/no attendees/i);
  });

  it("sends to every attendee, reports emailSent, and stamps the first send", async () => {
    const rec: Record<string, unknown> = {};
    vi.mocked(createClient).mockResolvedValue(
      makeClient({
        meetings: { rec, single: { data: meeting, error: null } },
        meeting_attendees: { settle: { data: [{ email: "a@x.com", display_name: "A" }, { email: "b@x.com", display_name: "B" }], error: null } },
      })
    );
    const res = await sendNoShowFollowUpAction(MID);
    expect(sendNoShowFollowUpEmail).toHaveBeenCalledTimes(2);
    expect(res.emailSent).toBe(true);
    expect(res.emailWarning).toBeUndefined();
    expect((rec.update as Record<string, unknown>).no_show_followup_sent_at).toBeTypeOf("string");
  });

  it("PARTIAL failure → emailSent false + warning, and does NOT claim a clean send", async () => {
    vi.mocked(sendNoShowFollowUpEmail).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: "recipient rejected" });
    const rec: Record<string, unknown> = {};
    vi.mocked(createClient).mockResolvedValue(
      makeClient({
        meetings: { rec, single: { data: meeting, error: null } },
        meeting_attendees: { settle: { data: [{ email: "a@x.com", display_name: "A" }, { email: "b@x.com", display_name: "B" }], error: null } },
      })
    );
    const res = await sendNoShowFollowUpAction(MID);
    expect(res.emailSent).toBe(false);
    expect(res.emailWarning).toContain("could not be delivered");
    // At least one went out → still stamp the historical evidence.
    expect((rec.update as Record<string, unknown>).no_show_followup_sent_at).toBeTypeOf("string");
  });

  it("TOTAL failure → not stamped (nothing was actually sent)", async () => {
    vi.mocked(sendNoShowFollowUpEmail).mockResolvedValue({ ok: false, error: "RESEND_API_KEY is not configured" });
    const rec: Record<string, unknown> = {};
    vi.mocked(createClient).mockResolvedValue(
      makeClient({
        meetings: { rec, single: { data: meeting, error: null } },
        meeting_attendees: { settle: { data: [{ email: "a@x.com", display_name: "A" }], error: null } },
      })
    );
    const res = await sendNoShowFollowUpAction(MID);
    expect(res.emailSent).toBe(false);
    expect(rec.update).toBeUndefined(); // no stamp when nothing was sent
  });

  it("preserves an existing follow-up timestamp (does not re-stamp on resend)", async () => {
    const rec: Record<string, unknown> = {};
    vi.mocked(createClient).mockResolvedValue(
      makeClient({
        meetings: { rec, single: { data: { ...meeting, no_show_followup_sent_at: "2026-09-01T11:00:00Z" }, error: null } },
        meeting_attendees: { settle: { data: [{ email: "a@x.com", display_name: "A" }], error: null } },
      })
    );
    const res = await sendNoShowFollowUpAction(MID);
    expect(res.emailSent).toBe(true);
    expect(rec.update).toBeUndefined(); // historical evidence preserved
  });
});

describe("updateMeetingAction — reschedule invalidation", () => {
  it("a TIME change clears no_show_at and consumes any outstanding token", async () => {
    const rec: Record<string, unknown> = {};
    vi.mocked(createClient).mockResolvedValue(
      makeClient({
        meetings: { rec, single: { data: { starts_at: "2026-09-01T09:00:00Z", ends_at: "2026-09-01T10:00:00Z" }, error: null }, settle: { error: null } },
        meeting_attendees: { settle: { error: null } },
      })
    );
    const res = await updateMeetingAction(MID, validInput({ startsAt: "2026-09-08T09:00:00Z", endsAt: "2026-09-08T10:00:00Z" }));
    expect(res).toEqual({ ok: true, id: MID });
    const payload = rec.update as Record<string, unknown>;
    expect(payload.no_show_at).toBeNull();
    expect(payload.reschedule_token_hash).toBeNull();
    expect(payload.reschedule_token_expires_at).toBeNull();
  });

  it("a metadata-only edit (same time) leaves no_show_at/token untouched", async () => {
    const rec: Record<string, unknown> = {};
    vi.mocked(createClient).mockResolvedValue(
      makeClient({
        meetings: { rec, single: { data: { starts_at: "2026-09-01T09:00:00Z", ends_at: "2026-09-01T10:00:00Z" }, error: null }, settle: { error: null } },
        meeting_attendees: { settle: { error: null } },
      })
    );
    await updateMeetingAction(MID, validInput({ title: "Renamed", startsAt: "2026-09-01T09:00:00Z", endsAt: "2026-09-01T10:00:00Z" }));
    const payload = rec.update as Record<string, unknown>;
    expect("no_show_at" in payload).toBe(false);
    expect("reschedule_token_hash" in payload).toBe(false);
  });
});

describe("cancelMeetingAction — token invalidation", () => {
  it("cancelling retires the outstanding self-service token", async () => {
    const rec: Record<string, unknown> = {};
    vi.mocked(createClient).mockResolvedValue(
      makeClient({ meetings: { rec, settle: { error: null } } })
    );
    const res = await cancelMeetingAction(MID);
    expect(res).toEqual({ ok: true, id: MID });
    const payload = rec.update as Record<string, unknown>;
    expect(payload.status).toBe("cancelled");
    expect(payload.reschedule_token_hash).toBeNull();
    expect(payload.reschedule_token_expires_at).toBeNull();
  });
});
