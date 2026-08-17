import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/google/calendar/availability", () => ({ listBusyIntervals: vi.fn(async () => []) }));
vi.mock("@/lib/planner/scheduling/service", () => ({ reconcileMeeting: vi.fn(async () => ({ result: "success" })) }));
vi.mock("@/lib/email/meeting-notifications", () => ({ sendMeetingConfirmationEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/net", () => ({ newCorrelationId: () => "cid" }));

import { loadRescheduleView, confirmRescheduleByToken } from "./reschedule-service";
import { hashRescheduleToken } from "./reschedule-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { listBusyIntervals } from "@/lib/google/calendar/availability";
import { reconcileMeeting } from "@/lib/planner/scheduling/service";
import { sendMeetingConfirmationEmail } from "@/lib/email/meeting-notifications";

const NOW = new Date("2026-08-16T00:00:00Z"); // Sunday 02:00 SAST
const RAW = "A".repeat(43); // well-formed base64url raw token
const HASH = hashRescheduleToken(RAW);
const SLOT_START = "2026-08-17T07:00:00.000Z"; // Mon 09:00 SAST — valid grid slot
const SLOT_END = "2026-08-17T08:00:00.000Z"; // +60min (server-derived)

// A no-show meeting is a valid reschedule target: no_show_at is set here on purpose.
const MEETING = {
  id: "mtg-1",
  title: "Strategy Meeting",
  starts_at: "2026-08-10T07:00:00.000Z",
  ends_at: "2026-08-10T08:00:00.000Z", // 60-min duration
  time_zone: "Africa/Johannesburg",
  no_show_at: "2026-08-10T09:00:00.000Z",
};

/** Configurable service-role client mock that records filter + rpc calls. */
function installAdmin(cfg: {
  meetings?: { single?: unknown; settle?: unknown };
  meeting_attendees?: { settle?: unknown };
  calendar_projections?: { single?: unknown };
  rpcResult?: { data: unknown; error: unknown };
}) {
  const calls: Record<string, unknown[][]> = { meetings: [], rpc: [] };
  const builders: Record<string, unknown> = {};
  const mk = (table: string, tc: { single?: unknown; settle?: unknown }) => {
    const rec = (m: string, a: unknown[]) => (calls[table] ??= []).push([m, ...a]);
    const b: Record<string, unknown> = {
      select: (...a: unknown[]) => (rec("select", a), b),
      eq: (...a: unknown[]) => (rec("eq", a), b),
      gt: (...a: unknown[]) => (rec("gt", a), b),
      lt: (...a: unknown[]) => (rec("lt", a), b),
      neq: (...a: unknown[]) => (rec("neq", a), b),
      is: (...a: unknown[]) => (rec("is", a), b),
      maybeSingle: async () => tc.single ?? { data: null, error: null },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(tc.settle ?? { data: [], error: null }).then(res, rej),
    };
    return b;
  };
  const client = {
    from: (t: string) => (builders[t] ??= mk(t, (cfg as Record<string, { single?: unknown; settle?: unknown }>)[t] ?? {})),
    rpc: (name: string, args: unknown) => {
      calls.rpc.push([name, args]);
      return Promise.resolve(cfg.rpcResult ?? { data: MEETING.id, error: null });
    },
  };
  vi.mocked(createAdminClient).mockReturnValue(client as never);
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listBusyIntervals).mockResolvedValue([]);
});

describe("loadRescheduleView", () => {
  it("rejects a malformed token generically, without any DB or Google call", async () => {
    const calls = installAdmin({});
    const view = await loadRescheduleView("not-a-valid-token", NOW);
    expect(view.status).toBe("invalid");
    expect(listBusyIntervals).not.toHaveBeenCalled();
  });

  it("returns 'invalid' when the token resolves to nothing", async () => {
    installAdmin({ meetings: { single: { data: null, error: null } } });
    expect((await loadRescheduleView(RAW, NOW)).status).toBe("invalid");
  });

  it("resolves ONLY live/unexpired/scheduled/undeleted tokens — and NOT on no_show_at", async () => {
    const calls = installAdmin({ meetings: { single: { data: MEETING, error: null } } });
    await loadRescheduleView(RAW, NOW);
    const flat = JSON.stringify(calls.meetings);
    expect(flat).toContain("reschedule_token_hash");
    expect(flat).toContain("scheduled");
    expect(flat).toContain("deleted_at");
    expect(flat).toContain("reschedule_token_expires_at");
    expect(flat).not.toContain("no_show"); // a no-show is a valid target, never a filter
  });

  it("FAILS CLOSED to 'unavailable' when Google availability can't be verified", async () => {
    installAdmin({ meetings: { single: { data: MEETING, error: null } } });
    vi.mocked(listBusyIntervals).mockRejectedValueOnce(new Error("timeout"));
    expect((await loadRescheduleView(RAW, NOW)).status).toBe("unavailable");
  });

  it("returns verified slots, excludes Portal+Google busy, and NEVER leaks the meeting id", async () => {
    installAdmin({
      meetings: {
        single: { data: MEETING, error: null },
        settle: { data: [{ starts_at: "2026-08-17T07:00:00.000Z", ends_at: "2026-08-17T07:30:00.000Z" }], error: null }, // portal blocks Mon 09:00
      },
    });
    vi.mocked(listBusyIntervals).mockResolvedValueOnce([
      { startsAt: "2026-08-17T07:30:00.000Z", endsAt: "2026-08-17T08:00:00.000Z" }, // google blocks Mon 09:30
    ]);
    const view = await loadRescheduleView(RAW, NOW);
    expect(view.status).toBe("ok");
    if (view.status !== "ok") return;
    expect(view.meeting).not.toHaveProperty("id"); // no enumeration surface
    expect(view.meeting.title).toBe("Strategy Meeting");
    const starts = view.days.flatMap((d) => d.slots.map((s) => s.startsAt));
    expect(starts).not.toContain("2026-08-17T07:00:00.000Z"); // portal-blocked
    expect(starts).not.toContain("2026-08-17T07:30:00.000Z"); // google-blocked
    expect(starts).toContain("2026-08-17T08:00:00.000Z"); // 10:00 free
  });
});

describe("confirmRescheduleByToken", () => {
  it("rejects a malformed token before any check", async () => {
    const calls = installAdmin({});
    expect((await confirmRescheduleByToken("bad", SLOT_START, NOW)).status).toBe("invalid");
    expect(calls.rpc).toHaveLength(0);
  });

  it("rejects an off-grid / past slot before touching Google or the DB", async () => {
    const calls = installAdmin({ meetings: { single: { data: MEETING, error: null } } });
    expect((await confirmRescheduleByToken(RAW, "2026-08-17T07:07:00.000Z", NOW)).status).toBe("slot_invalid");
    expect(listBusyIntervals).not.toHaveBeenCalled();
    expect(calls.rpc).toHaveLength(0);
  });

  it("returns slot_taken on a Portal overlap — before Google, before the RPC", async () => {
    const calls = installAdmin({
      meetings: { single: { data: MEETING, error: null }, settle: { data: [{ starts_at: SLOT_START, ends_at: SLOT_END }], error: null } },
    });
    expect((await confirmRescheduleByToken(RAW, SLOT_START, NOW)).status).toBe("slot_taken");
    expect(listBusyIntervals).not.toHaveBeenCalled();
    expect(calls.rpc).toHaveLength(0);
  });

  it("returns slot_taken when Google is now busy — and does NOT mutate", async () => {
    const calls = installAdmin({ meetings: { single: { data: MEETING, error: null } } });
    vi.mocked(listBusyIntervals).mockResolvedValueOnce([{ startsAt: SLOT_START, endsAt: SLOT_END }]);
    expect((await confirmRescheduleByToken(RAW, SLOT_START, NOW)).status).toBe("slot_taken");
    expect(calls.rpc).toHaveLength(0);
  });

  it("FAILS CLOSED (unavailable) and does NOT mutate when Google can't be verified at confirm", async () => {
    const calls = installAdmin({ meetings: { single: { data: MEETING, error: null } } });
    vi.mocked(listBusyIntervals).mockRejectedValueOnce(new Error("google down"));
    expect((await confirmRescheduleByToken(RAW, SLOT_START, NOW)).status).toBe("unavailable");
    expect(calls.rpc).toHaveLength(0);
    expect(reconcileMeeting).not.toHaveBeenCalled();
  });

  it("maps the RPC's atomic guards: slot_taken / reschedule_link_invalid / invalid_slot", async () => {
    installAdmin({ meetings: { single: { data: MEETING, error: null } }, rpcResult: { data: null, error: { message: "slot_taken" } } });
    expect((await confirmRescheduleByToken(RAW, SLOT_START, NOW)).status).toBe("slot_taken");
    installAdmin({ meetings: { single: { data: MEETING, error: null } }, rpcResult: { data: null, error: { message: "reschedule_link_invalid" } } });
    expect((await confirmRescheduleByToken(RAW, SLOT_START, NOW)).status).toBe("invalid");
    installAdmin({ meetings: { single: { data: MEETING, error: null } }, rpcResult: { data: null, error: { message: "invalid_slot" } } });
    expect((await confirmRescheduleByToken(RAW, SLOT_START, NOW)).status).toBe("slot_invalid");
  });

  it("on success: calls the service-role RPC with a SERVER-derived end, reconciles the SAME meeting, emails attendees", async () => {
    const calls = installAdmin({
      meetings: { single: { data: MEETING, error: null } },
      meeting_attendees: { settle: { data: [{ email: "vm@client.com", display_name: "VM" }], error: null } },
      calendar_projections: { single: { data: { meet_url: "https://meet.google.com/abc" }, error: null } },
      rpcResult: { data: MEETING.id, error: null },
    });
    const res = await confirmRescheduleByToken(RAW, SLOT_START, NOW);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.meeting).toEqual({ title: "Strategy Meeting", startsAt: SLOT_START, endsAt: SLOT_END, timeZone: "Africa/Johannesburg" });

    // Exactly one atomic confirm, hash + server-derived window (end never trusted from client).
    expect(calls.rpc).toHaveLength(1);
    const [name, args] = calls.rpc[0] as [string, { p_token_hash: string; p_starts_at: string; p_ends_at: string }];
    expect(name).toBe("confirm_meeting_reschedule");
    expect(args).toEqual({ p_token_hash: HASH, p_starts_at: SLOT_START, p_ends_at: SLOT_END });

    // SAME meeting is reconciled (patches the existing Google event — no new event/Meet).
    expect(reconcileMeeting).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reconcileMeeting).mock.calls[0][0]).toBe(MEETING.id);

    // Confirmation email to attendees (best-effort, with the new time).
    expect(sendMeetingConfirmationEmail).toHaveBeenCalledTimes(1);
    const emailArg = vi.mocked(sendMeetingConfirmationEmail).mock.calls[0][0];
    expect(emailArg.startsAt).toBe(SLOT_START);
    expect(emailArg.meetUrl).toBe("https://meet.google.com/abc");
  });
});
