import { describe, it, expect } from "vitest";
import { meetingToDesiredDraft } from "./desired";
import { computeDesiredHash } from "@/lib/planner/scheduling/hash";

/**
 * Google inertness proof for 0054. attended_at / outcome_notes / thank_you_sent_at
 * must be STRUCTURALLY absent from the projection desired state — the loader
 * selects an explicit column list and meetingToDesiredDraft reads only projection
 * fields, so these annotations can never enter the desired draft or its hash.
 * Therefore marking attended / editing notes / recording a follow-up performs no
 * Google write. (loader.ts / desired.ts / hash.ts remain UNMODIFIED.)
 */

const projectionRow = {
  id: "m1",
  title: "Sync",
  description: null,
  starts_at: "2026-09-01T09:00:00Z",
  ends_at: "2026-09-01T10:00:00Z",
  time_zone: "Africa/Johannesburg",
  has_meet: true,
  status: "scheduled" as const,
  deleted_at: null,
};

describe("0054 annotations are inert to the Google projection", () => {
  it("meetingToDesiredDraft ignores attended_at / outcome_notes / thank_you_sent_at", () => {
    // Same row, once plain and once carrying the 0054 annotations (+ sensitive notes).
    const withAnnotations = {
      ...projectionRow,
      attended_at: "2026-09-01T10:05:00Z",
      outcome_notes: "INTERNAL: do not leak to Google",
      thank_you_sent_at: "2026-09-01T11:00:00Z",
    } as typeof projectionRow;

    const draftPlain = meetingToDesiredDraft(projectionRow, [], "cal-1");
    const draftAnnotated = meetingToDesiredDraft(withAnnotations, [], "cal-1");

    // Identical desired draft — the annotations changed nothing.
    expect(draftAnnotated).toEqual(draftPlain);
    const json = JSON.stringify(draftAnnotated);
    expect(json).not.toContain("attended_at");
    expect(json).not.toContain("outcome_notes");
    expect(json).not.toContain("thank_you");
    expect(json).not.toContain("INTERNAL");
  });

  it("computeDesiredHash is unchanged by the annotations", () => {
    const plain = { ...meetingToDesiredDraft(projectionRow, [], "cal-1"), idEpoch: 1 };
    const annotatedRow = {
      ...projectionRow,
      attended_at: "2026-09-01T10:05:00Z",
      outcome_notes: "secret",
      thank_you_sent_at: "2026-09-01T11:00:00Z",
    } as typeof projectionRow;
    const annotated = { ...meetingToDesiredDraft(annotatedRow, [], "cal-1"), idEpoch: 1 };
    expect(computeDesiredHash(annotated)).toBe(computeDesiredHash(plain));
  });
});
