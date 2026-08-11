/**
 * Weekly Updates — pure merge/group/sort/filter (NO I/O, NO clock, client-safe).
 *
 * Answers "what did we get done this week?". The server merges two sources into
 * one presentation-safe `WeeklyUpdateItem[]` — completed Planner tasks (source
 * 'task', attributed by completed_by) and manual entries (source 'manual',
 * attributed to their author) — and this module groups them by member, filters,
 * and sorts deterministically for the client island. No raw Task or DB row ever
 * reaches the client; every date is a pre-formatted label + an ISO sort key, so
 * the client never touches the clock (hydration-stable).
 */
export type UpdateSource = "task" | "manual";

export const INTERNAL_CLIENT_LABEL = "Internal / No client";

/** A single accomplished item — a completed task ✓ or a manual note •. */
export interface WeeklyUpdateItem {
  id: string;
  source: UpdateSource; // internal only — the UI shows ✓ vs a subtle "Manual" tag
  text: string; // task title or manual summary
  memberId: string; // completed_by (task) or author_user_id (manual)
  memberName: string;
  clientId: string | null;
  /** Real client name, "Unknown client" (unresolved real id), or null → Internal. */
  clientName: string | null;
  dateLabel: string; // pre-formatted agency-local, e.g. "Tue 12 Aug"
  sortAt: string; // ISO instant for deterministic ordering
  canDelete: boolean; // manual AND authored by the viewer
}

export interface MemberUpdates {
  memberId: string;
  memberName: string;
  count: number;
  items: WeeklyUpdateItem[];
}

export interface WeeklyFilter {
  memberId: string | "all";
  search: string;
}

/** Newest-first within a member; ties broken by source then id (fully deterministic). */
function byRecencyThenStable(a: WeeklyUpdateItem, b: WeeklyUpdateItem): number {
  if (a.sortAt !== b.sortAt) return a.sortAt < b.sortAt ? 1 : -1; // desc
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Group the week's items by member for display. Applies the member filter and a
 * case-insensitive search over text + client name. Only members WITH matching
 * items appear. Members sort by most-completed first, then name, then id.
 */
export function computeWeekly(items: readonly WeeklyUpdateItem[], filter: WeeklyFilter): MemberUpdates[] {
  const term = filter.search.trim().toLowerCase();
  const filtered = items.filter((it) => {
    if (filter.memberId !== "all" && it.memberId !== filter.memberId) return false;
    if (term.length > 0) {
      const hay = `${it.text} ${it.clientName ?? INTERNAL_CLIENT_LABEL}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });

  const byMember = new Map<string, MemberUpdates>();
  for (const it of filtered) {
    const g = byMember.get(it.memberId);
    if (g) g.items.push(it);
    else byMember.set(it.memberId, { memberId: it.memberId, memberName: it.memberName, count: 0, items: [it] });
  }

  const groups = [...byMember.values()];
  for (const g of groups) {
    g.items.sort(byRecencyThenStable);
    g.count = g.items.length;
  }
  return groups.sort((a, b) => b.count - a.count || a.memberName.localeCompare(b.memberName) || (a.memberId < b.memberId ? -1 : 1));
}

/** Total items across all groups (for the header count). */
export function totalItems(groups: readonly MemberUpdates[]): number {
  return groups.reduce((n, g) => n + g.count, 0);
}
