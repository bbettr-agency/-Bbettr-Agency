/**
 * Pure Join-button visibility logic (0-dependency, testable). A meeting's Join
 * action is PROMINENT from LEAD_MS before the start until the end; outside that
 * window the link stays available but subtle. (Whether a Join exists at all is a
 * separate check: only when a stored meet_url is present.)
 */

/** Prominent from 10 minutes before start. */
export const JOIN_LEAD_MS = 10 * 60 * 1000;

export function isJoinProminent(nowMs: number, startsAt: string, endsAt: string): boolean {
  const startMs = Date.parse(startsAt);
  const endMs = Date.parse(endsAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  return nowMs >= startMs - JOIN_LEAD_MS && nowMs <= endMs;
}
