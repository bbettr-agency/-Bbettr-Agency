import { describe, it, expect, beforeEach, vi } from "vitest";

// Confirmation email is NON-FATAL and honestly reported: the meeting is created
// regardless, and emailSent/emailWarning reflect the real send outcome. Replays
// must not re-send.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ id: "admin-uid", role: "admin" })) }));
vi.mock("@/lib/flags", () => ({ isPlannerEnabled: vi.fn(() => true) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/planner/scheduling/service", () => ({ reconcileMeeting: vi.fn(async () => ({ result: "success" })) }));
vi.mock("@/lib/email/meeting-notifications", () => ({ sendMeetingConfirmationEmail: vi.fn(async () => ({ ok: true })) }));

import { createMeetingAction } from "./actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMeetingConfirmationEmail } from "@/lib/email/meeting-notifications";
import type { MeetingInput } from "./types";

const MID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const input = (over: Partial<MeetingInput> = {}): MeetingInput => ({
  title: "Client kickoff",
  description: null,
  startsAt: "2026-08-13T10:30:00Z",
  endsAt: "2026-08-13T11:30:00Z",
  timeZone: "Africa/Johannesburg",
  hasMeet: true,
  attendees: [{ email: "vm@client.com", displayName: "Vision Motors" }],
  ...over,
});

/** Session client: idempotency lookup → `existing`, RPC create → MID. */
function fakeSession(existing: { id: string } | null = null) {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing }) }) }) }),
    rpc: vi.fn(async () => ({ data: MID, error: null })),
  };
}
/** Admin client: calendar_projections meet_url read. */
function fakeAdmin(meetUrl: string | null = "https://meet.google.com/abc") {
  return { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: meetUrl ? { meet_url: meetUrl } : null }) }) }) }) }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockResolvedValue(fakeSession() as never);
  vi.mocked(createAdminClient).mockReturnValue(fakeAdmin() as never);
  vi.mocked(sendMeetingConfirmationEmail).mockResolvedValue({ ok: true });
});

describe("createMeetingAction — confirmation email", () => {
  it("creates the meeting and reports the confirmation as sent (incl. Meet link)", async () => {
    const res = await createMeetingAction(input(), "idem-1");
    expect(res.ok).toBe(true);
    expect(res.id).toBe(MID);
    expect(res.emailSent).toBe(true);
    expect(res.emailWarning).toBeUndefined();
    expect(sendMeetingConfirmationEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendMeetingConfirmationEmail).mock.calls[0][0];
    expect(call.to).toBe("vm@client.com");
    expect(call.meetUrl).toBe("https://meet.google.com/abc");
  });

  it("email failure is NON-FATAL: meeting still created, honest warning surfaced", async () => {
    vi.mocked(sendMeetingConfirmationEmail).mockResolvedValue({ ok: false, error: "RESEND_API_KEY is not configured" });
    const res = await createMeetingAction(input(), "idem-2");
    expect(res.ok).toBe(true); // meeting created regardless
    expect(res.id).toBe(MID);
    expect(res.emailSent).toBe(false);
    expect(res.emailWarning).toContain("could not be delivered");
    expect(res.emailWarning).toContain("RESEND_API_KEY is not configured");
  });

  it("no attendees → no email sent, still a clean success", async () => {
    const res = await createMeetingAction(input({ attendees: [] }), "idem-3");
    expect(res.ok).toBe(true);
    expect(sendMeetingConfirmationEmail).not.toHaveBeenCalled();
    expect(res.emailSent).toBeUndefined();
    expect(res.emailWarning).toBeUndefined();
  });

  it("a replay (idempotency hit) returns the existing meeting and does NOT re-send", async () => {
    vi.mocked(createClient).mockResolvedValue(fakeSession({ id: MID }) as never);
    const res = await createMeetingAction(input(), "idem-1");
    expect(res).toEqual({ ok: true, id: MID });
    expect(sendMeetingConfirmationEmail).not.toHaveBeenCalled();
  });

  it("does not read the Meet link when the meeting has no Meet", async () => {
    await createMeetingAction(input({ hasMeet: false }), "idem-4");
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(vi.mocked(sendMeetingConfirmationEmail).mock.calls[0][0].meetUrl).toBeNull();
  });
});
