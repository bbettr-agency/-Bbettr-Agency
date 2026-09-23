import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import type { MemoryCategory, MemoryScope } from "./types";
import type { MemorySummary } from "./context-shape";

export type { MemorySummary } from "./context-shape";

/**
 * Memory read layer (server-only), structured retrieval ONLY — no FTS, no
 * embeddings (Part 16). Reads run under the CALLER's RLS: admins read all memory
 * in their agency workspace; clients/reps see nothing. Every query is bounded.
 */

type MemoryRow = Database["public"]["Tables"]["jarvis_memories"]["Row"];

const COLUMNS =
  "id, scope, client_id, user_id, category, claim, importance, state, current, source_kind, source_ref, observed_at, supplied_display, confirmed_at, conflicts_with_id, supersedes_id, superseded_by_id";

function toSummary(r: MemoryRow): MemorySummary {
  return {
    id: r.id,
    scope: r.scope,
    clientId: r.client_id,
    userId: r.user_id,
    category: r.category,
    claim: r.claim,
    importance: r.importance ?? 0,
    state: r.state,
    current: !!r.current,
    sourceKind: r.source_kind,
    sourceRef: r.source_ref,
    observedAt: r.observed_at,
    suppliedDisplay: r.supplied_display,
    confirmedAt: r.confirmed_at,
    conflictsWithId: r.conflicts_with_id,
    supersedesId: r.supersedes_id,
    supersededById: r.superseded_by_id,
  };
}

export interface MemoryQuery {
  scope?: MemoryScope;
  clientId?: string;
  userId?: string;
  category?: MemoryCategory;
  /** Only active-truth (current) rows. Default true. */
  currentOnly?: boolean;
  limit?: number;
}

/** Bounded, ordered current-memory retrieval (importance, then recency). */
export async function listMemories(q: MemoryQuery = {}): Promise<MemorySummary[]> {
  const supabase = await createClient();
  let query = supabase.from("jarvis_memories").select(COLUMNS);
  if (q.scope) query = query.eq("scope", q.scope);
  if (q.clientId) query = query.eq("client_id", q.clientId);
  if (q.userId) query = query.eq("user_id", q.userId);
  if (q.category) query = query.eq("category", q.category);
  if (q.currentOnly !== false) query = query.eq("current", true);
  const { data } = await query
    .order("importance", { ascending: false })
    .order("observed_at", { ascending: false })
    .limit(Math.min(q.limit ?? 50, 200));
  return ((data ?? []) as unknown as MemoryRow[]).map(toSummary);
}

/** A single memory (any state) in the caller's workspace. */
export async function getMemory(id: string): Promise<MemorySummary | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("jarvis_memories").select(COLUMNS).eq("id", id).maybeSingle();
  return data ? toSummary(data as unknown as MemoryRow) : null;
}

/**
 * Reconstruct a supersession chain for historical reasoning: walk backwards via
 * supersedes_id and forwards via superseded_by_id from the given memory. Bounded.
 */
export async function getMemoryHistory(id: string, maxDepth = 25): Promise<MemorySummary[]> {
  const seen = new Map<string, MemorySummary>();
  const start = await getMemory(id);
  if (!start) return [];
  seen.set(start.id, start);

  let cursor: string | null = start.supersedesId;
  let depth = 0;
  while (cursor && depth < maxDepth && !seen.has(cursor)) {
    const row = await getMemory(cursor);
    if (!row) break;
    seen.set(row.id, row);
    cursor = row.supersedesId;
    depth++;
  }
  cursor = start.supersededById;
  depth = 0;
  while (cursor && depth < maxDepth && !seen.has(cursor)) {
    const row = await getMemory(cursor);
    if (!row) break;
    seen.set(row.id, row);
    cursor = row.supersededById;
    depth++;
  }
  return [...seen.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
}

/** Current memories that carry an unresolved conflict flag (optionally per client). */
export async function listUnresolvedConflicts(clientId?: string, limit = 25): Promise<MemorySummary[]> {
  const supabase = await createClient();
  let query = supabase.from("jarvis_memories").select(COLUMNS).eq("current", true).not("conflicts_with_id", "is", null);
  if (clientId) query = query.eq("client_id", clientId);
  const { data } = await query.order("observed_at", { ascending: false }).limit(Math.min(limit, 100));
  return ((data ?? []) as unknown as MemoryRow[]).map(toSummary);
}

export interface MemoryEventRow {
  eventType: string;
  actorDisplay: string | null;
  reason: string | null;
  occurredAt: string;
}

/** Lineage events for one memory (admin-only under RLS). */
export async function listMemoryEvents(memoryId: string, limit = 50): Promise<MemoryEventRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jarvis_memory_events")
    .select("event_type, actor_display, reason, occurred_at")
    .eq("memory_id", memoryId)
    .order("occurred_at", { ascending: false })
    .limit(Math.min(limit, 200));
  return (data ?? []).map((r) => ({
    eventType: r.event_type,
    actorDisplay: r.actor_display,
    reason: r.reason,
    occurredAt: r.occurred_at,
  }));
}
