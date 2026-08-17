/**
 * Self-service reschedule availability engine (Slice D) — PURE and I/O-free, so
 * every rule is unit-testable. A candidate slot is offered only when it clears
 * all three layers (the caller supplies the busy intervals):
 *
 *   BUSINESS HOURS  ∩  PORTAL AVAILABILITY  ∩  GOOGLE AVAILABILITY
 *
 * Locked defaults: Monday–Friday, 09:00–17:00 in the MEETING's time zone,
 * 30-minute increments, the next 14 days, the meeting's existing duration, past
 * slots excluded. This module owns only BUSINESS HOURS + interval intersection;
 * the Portal and Google busy intervals are fetched server-side and passed in.
 */

export interface TimeInterval {
  startsAt: string; // ISO instant
  endsAt: string; // ISO instant
}

export type Slot = TimeInterval;

export const BUSINESS = {
  /** 09:00, in minutes past local midnight. */
  startMinute: 9 * 60,
  /** 17:00 — a slot's wall-clock end must not exceed this. */
  endMinute: 17 * 60,
  /** 30-minute grid. */
  stepMinutes: 30,
  /** Rolling window: today + the next 13 days. */
  horizonDays: 14,
} as const;

/**
 * A wall-clock time (date + minutes-past-midnight) in `tz` → the UTC ISO
 * instant. DST-correct: the tz offset is resolved AT that instant, so 09:00 in
 * America/New_York maps to the right UTC hour on both sides of a DST change.
 * Same algorithm the meeting form uses, so generated slots align exactly with
 * how meeting times are stored.
 */
export function wallClockToUtcIso(dateYmd: string, minutes: number, tz: string): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  const asUTC = Date.parse(`${dateYmd}T${hh}:${mm}:00Z`);
  const tzT = Date.parse(new Date(asUTC).toLocaleString("en-US", { timeZone: tz }));
  const utcT = Date.parse(new Date(asUTC).toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(asUTC - (tzT - utcT)).toISOString();
}

/** The `tz` calendar date (YYYY-MM-DD) of an instant. */
export function tzDate(instantMs: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instantMs));
}

/** Half-open overlap test on [start, end) intervals (ms). */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * All business-hour candidate slots for the window: Mon–Fri, 09:00–17:00 (in
 * `tz`), on a 30-minute grid, whose wall-clock end ≤ 17:00, over today + the
 * next 13 days, excluding any slot starting at/before `now`. Chronological.
 */
export function generateBusinessSlots(opts: {
  now: Date;
  tz: string;
  durationMs: number;
}): Slot[] {
  const { now, tz, durationMs } = opts;
  const durationMin = Math.round(durationMs / 60000);
  if (durationMin <= 0 || durationMin > BUSINESS.endMinute - BUSINESS.startMinute) return [];

  const nowMs = now.getTime();
  const [y, m, d] = tzDate(nowMs, tz).split("-").map(Number);
  const lastStart = BUSINESS.endMinute - durationMin; // so wall-clock end ≤ 17:00

  const slots: Slot[] = [];
  for (let offset = 0; offset < BUSINESS.horizonDays; offset++) {
    // Plain-date math in UTC (no DST drift on the DATE), then read its weekday.
    const day = new Date(Date.UTC(y, m - 1, d + offset));
    const dow = day.getUTCDay(); // 0 Sun … 6 Sat
    if (dow === 0 || dow === 6) continue; // Mon–Fri only
    const ymd = day.toISOString().slice(0, 10);

    for (let min = BUSINESS.startMinute; min <= lastStart; min += BUSINESS.stepMinutes) {
      const startIso = wallClockToUtcIso(ymd, min, tz);
      const startMs = Date.parse(startIso);
      if (startMs <= nowMs) continue; // exclude past
      slots.push({ startsAt: startIso, endsAt: new Date(startMs + durationMs).toISOString() });
    }
  }
  return slots;
}

/** Drop every slot that overlaps any busy interval. Malformed intervals ignored. */
export function removeOverlapping(slots: Slot[], busy: TimeInterval[]): Slot[] {
  const intervals = busy
    .map((b) => [Date.parse(b.startsAt), Date.parse(b.endsAt)] as const)
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s);
  if (intervals.length === 0) return slots;
  return slots.filter((slot) => {
    const s = Date.parse(slot.startsAt);
    const e = Date.parse(slot.endsAt);
    return !intervals.some(([bs, be]) => overlaps(s, e, bs, be));
  });
}

/**
 * BUSINESS ∩ PORTAL ∩ GOOGLE. The caller is responsible for failing closed if
 * the Google busy set can't be determined — this pure function assumes the
 * intervals it is given are authoritative.
 */
export function computeAvailableSlots(opts: {
  now: Date;
  tz: string;
  durationMs: number;
  portalBusy: TimeInterval[];
  googleBusy: TimeInterval[];
}): Slot[] {
  const base = generateBusinessSlots(opts);
  return removeOverlapping(removeOverlapping(base, opts.portalBusy), opts.googleBusy);
}

/**
 * Confirm-time check: is `slotStartIso` an exact member of the business-hour
 * grid for this window (and not in the past)? Returns the matching end instant
 * so the caller derives the slot end from the SERVER, never from the client.
 */
export function resolveAllowedSlot(
  slotStartIso: string,
  opts: { now: Date; tz: string; durationMs: number }
): { ok: true; endsAt: string } | { ok: false } {
  const target = Date.parse(slotStartIso);
  if (!Number.isFinite(target)) return { ok: false };
  const match = generateBusinessSlots(opts).find((s) => Date.parse(s.startsAt) === target);
  return match ? { ok: true, endsAt: match.endsAt } : { ok: false };
}

export interface DaySlots {
  dateYmd: string;
  slots: Slot[];
}

/** Group chronological slots into per-day buckets (in `tz`), order preserved. */
export function groupByDay(slots: Slot[], tz: string): DaySlots[] {
  const groups: DaySlots[] = [];
  let current: DaySlots | null = null;
  for (const slot of slots) {
    const key = tzDate(Date.parse(slot.startsAt), tz);
    if (!current || current.dateYmd !== key) {
      current = { dateYmd: key, slots: [] };
      groups.push(current);
    }
    current.slots.push(slot);
  }
  return groups;
}
