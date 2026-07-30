import { describe, it, expect } from "vitest";
import {
  meetStateFromEvent,
  meetUrlFromEvent,
  toGoogleEventBody,
  type GoogleEventResource,
} from "./mapper";
import type { DesiredEvent } from "@/lib/planner/scheduling/types";

const base: DesiredEvent = {
  entityType: "meeting",
  entityId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  idEpoch: 0,
  calendarId: "info@bbettragency.com",
  title: "Kickoff",
  description: "Notes",
  startsAt: "2026-08-01T09:00:00.000Z",
  endsAt: "2026-08-01T10:00:00.000Z",
  timeZone: "Africa/Johannesburg",
  attendees: [{ email: "guest@example.com", displayName: "Guest" }],
  wantsMeet: false,
  intent: "active",
};

describe("toGoogleEventBody", () => {
  it("sets a deterministic id, summary, and start/end with explicit IANA timeZone", () => {
    const body = toGoogleEventBody(base) as Record<string, { timeZone?: string }>;
    expect(typeof (body as { id: string }).id).toBe("string");
    expect((body as { summary: string }).summary).toBe("Kickoff");
    expect(body.start.timeZone).toBe("Africa/Johannesburg");
    expect(body.end.timeZone).toBe("Africa/Johannesburg");
  });

  it("maps attendees to Google guests", () => {
    const body = toGoogleEventBody(base) as {
      attendees: { email: string }[];
    };
    expect(body.attendees).toEqual([
      { email: "guest@example.com", displayName: "Guest" },
    ]);
  });

  it("omits conferenceData unless Meet is requested", () => {
    expect(toGoogleEventBody(base)).not.toHaveProperty("conferenceData");
    const withMeet = toGoogleEventBody({ ...base, wantsMeet: true }) as {
      conferenceData?: { createRequest?: { requestId?: string } };
    };
    expect(withMeet.conferenceData?.createRequest?.requestId).toBeTruthy();
  });

  it("marks the event cancelled when intent is cancelled", () => {
    const body = toGoogleEventBody({ ...base, intent: "cancelled" }) as {
      status: string;
    };
    expect(body.status).toBe("cancelled");
  });
});

describe("meet extraction", () => {
  const withVideo: GoogleEventResource = {
    id: "abc",
    conferenceData: {
      entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/xyz" }],
    },
  };

  it("reads the Meet video URL", () => {
    expect(meetUrlFromEvent(withVideo)).toBe("https://meet.google.com/xyz");
    expect(meetUrlFromEvent({ id: "x" })).toBeNull();
  });

  it("derives explicit meet_state", () => {
    expect(meetStateFromEvent({ id: "x" }, false).state).toBe("not_requested");
    expect(meetStateFromEvent(withVideo, true).state).toBe("ready");
    expect(
      meetStateFromEvent(
        { id: "x", conferenceData: { createRequest: { status: { statusCode: "pending" } } } },
        true
      ).state
    ).toBe("pending");
    const failed = meetStateFromEvent(
      { id: "x", conferenceData: { createRequest: { status: { statusCode: "failure" } } } },
      true
    );
    expect(failed.state).toBe("failed");
    expect(failed.error).toBe("conference_create_failed");
  });
});
