import { createHash } from "node:crypto";
import type { DesiredEvent } from "./types";

/**
 * Stable content hash of the desired event. Drives no-op skips and edit
 * detection: if the desired hash equals the last-synced hash, Google already
 * matches and no call is made. It is a digest ONLY — never stored/logged content.
 *
 * idEpoch is included, so a rebuild (epoch bump) changes the hash and forces a
 * fresh projection under the new deterministic id. Attendees are order-normalised
 * so a reordering isn't seen as a change.
 */
export function computeDesiredHash(d: DesiredEvent): string {
  const canonical = JSON.stringify({
    t: d.title,
    d: d.description ?? null,
    s: d.startsAt,
    e: d.endsAt,
    z: d.timeZone,
    m: d.wantsMeet,
    i: d.intent,
    c: d.calendarId,
    ep: d.idEpoch,
    a: [...d.attendees]
      .map((x) => ({ e: x.email.toLowerCase(), n: x.displayName ?? null }))
      .sort((x, y) => (x.e < y.e ? -1 : x.e > y.e ? 1 : 0)),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
