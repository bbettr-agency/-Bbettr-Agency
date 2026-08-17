import { describe, it, expect } from "vitest";
import { toCalendarMeeting } from "./view-types";
import type { Meeting } from "@/lib/database.types";

/**
 * The client calendar surface must never receive privileged/sensitive columns.
 * toCalendarMeeting is the whitelist that keeps reschedule_token_hash (and
 * friends) off the RSC → browser boundary.
 */
describe("toCalendarMeeting (client-safe projection)", () => {
  const fullRow: Meeting = {
    id: "m1",
    title: "Sync",
    description: "secret desc",
    starts_at: "2026-09-01T09:00:00Z",
    ends_at: "2026-09-01T10:00:00Z",
    time_zone: "Africa/Johannesburg",
    has_meet: true,
    status: "scheduled",
    idempotency_key: "idem-123",
    created_by: "user-uuid",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    cancelled_by: null,
    cancelled_at: null,
    deleted_at: null,
    no_show_at: null,
    no_show_followup_sent_at: null,
    reschedule_token_hash: "a".repeat(64),
    reschedule_token_expires_at: "2026-09-15T00:00:00Z",
    attended_at: "2026-09-01T10:05:00Z",
    outcome_notes: "internal",
    thank_you_sent_at: null,
  };

  it("strips the reschedule token, audit + idempotency fields", () => {
    const safe = toCalendarMeeting(fullRow);
    const json = JSON.stringify(safe);
    for (const forbidden of [
      "reschedule_token_hash",
      "reschedule_token_expires_at",
      "created_by",
      "idempotency_key",
      "outcome_notes",
    ]) {
      expect(json).not.toContain(forbidden);
    }
    expect("reschedule_token_hash" in safe).toBe(false);
  });

  it("keeps exactly the lifecycle-relevant fields", () => {
    expect(Object.keys(toCalendarMeeting(fullRow)).sort()).toEqual(
      [
        "attended_at",
        "ends_at",
        "id",
        "no_show_at",
        "no_show_followup_sent_at",
        "starts_at",
        "status",
        "thank_you_sent_at",
        "time_zone",
        "title",
      ].sort()
    );
  });
});
