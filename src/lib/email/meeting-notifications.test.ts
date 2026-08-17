import { describe, it, expect, beforeEach, vi } from "vitest";

// Assert the branded confirmation content (subject + rendered HTML) — recipient,
// title, timezone-correct date/time, and the Meet link only when present.
vi.mock("@/lib/email/resend", () => ({ sendTransactionalEmail: vi.fn(async () => ({ ok: true })) }));

import { sendMeetingConfirmationEmail, sendNoShowFollowUpEmail } from "./meeting-notifications";
import { sendTransactionalEmail } from "@/lib/email/resend";

const lastSend = () => vi.mocked(sendTransactionalEmail).mock.calls.at(-1)![0];

beforeEach(() => vi.mocked(sendTransactionalEmail).mockClear());

describe("sendMeetingConfirmationEmail", () => {
  it("sends to the attendee with title, timezone-correct date/time, and the Meet link", async () => {
    const res = await sendMeetingConfirmationEmail({
      to: "vm@client.com",
      attendeeName: "Vision Motors",
      title: "Strategy Meeting",
      startsAt: "2026-08-13T10:30:00Z", // 12:30 in Africa/Johannesburg (UTC+2)
      endsAt: "2026-08-13T11:30:00Z", // 13:30
      timeZone: "Africa/Johannesburg",
      meetUrl: "https://meet.google.com/abc-defg-hij",
    });
    expect(res.ok).toBe(true);
    const sent = lastSend();
    expect(sent.to).toBe("vm@client.com");
    expect(sent.subject).toBe("Meeting confirmed: Strategy Meeting");
    expect(sent.html).toContain("Strategy Meeting");
    expect(sent.html).toContain("13 August 2026");
    expect(sent.html).toContain("12:30"); // agency-local start
    expect(sent.html).toContain("13:30"); // agency-local end
    expect(sent.html).toContain("Africa/Johannesburg");
    expect(sent.html).toContain("https://meet.google.com/abc-defg-hij");
    expect(sent.html).toContain("Vision Motors"); // greeting
  });

  it("omits the Meet link when none is available", async () => {
    await sendMeetingConfirmationEmail({
      to: "x@y.com",
      title: "Kickoff",
      startsAt: "2026-08-13T10:30:00Z",
      endsAt: "2026-08-13T11:30:00Z",
      timeZone: "Africa/Johannesburg",
      meetUrl: null,
    });
    expect(lastSend().html).not.toContain("meet.google.com");
    expect(lastSend().html).not.toContain("Join Google Meet");
  });

  it("falls back to a neutral greeting when the attendee name is absent", async () => {
    await sendMeetingConfirmationEmail({
      to: "x@y.com",
      attendeeName: null,
      title: "Kickoff",
      startsAt: "2026-08-13T10:30:00Z",
      endsAt: "2026-08-13T11:30:00Z",
      timeZone: "Africa/Johannesburg",
    });
    expect(lastSend().html).toContain("Hi there,");
  });
});

describe("sendNoShowFollowUpEmail (Slice D — secure reschedule CTA)", () => {
  it("embeds the /reschedule/<raw-token> CTA and the missed date/time", async () => {
    const res = await sendNoShowFollowUpEmail({
      to: "vm@client.com",
      attendeeName: "Vision Motors",
      title: "Strategy Meeting",
      startsAt: "2026-08-13T10:30:00Z", // 12:30 Africa/Johannesburg
      endsAt: "2026-08-13T11:30:00Z",
      timeZone: "Africa/Johannesburg",
      rescheduleUrl: "https://portal.bbettragency.com/reschedule/RAW_TOKEN_VALUE",
    });
    expect(res.ok).toBe(true);
    const sent = lastSend();
    expect(sent.subject).toBe("Reschedule your meeting: Strategy Meeting");
    expect(sent.html).toContain("Vision Motors");
    expect(sent.html).toContain("13 August 2026");
    expect(sent.html).toContain("12:30");
    expect(sent.html).toContain("Reschedule Meeting"); // CTA label
    expect(sent.html).toContain("https://portal.bbettragency.com/reschedule/RAW_TOKEN_VALUE");
  });
});
