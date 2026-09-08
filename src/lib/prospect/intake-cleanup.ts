/**
 * Stale/expired prospect-draft cleanup (P2-E) — pure orchestration, no I/O.
 *
 * Eligibility is EXACTLY: status = 'draft' AND token_expires_at < now(). Such a
 * row's link is already dead (resolves to "expired") and was never submitted, so
 * it carries PII with no product value → it is hard-deleted (data minimisation).
 * NOTHING else is ever touched: submitted / converted / dismissed and any
 * non-expired draft are always preserved, regardless of age.
 *
 * The store boundary is injected so this is unit-testable without a DB. The real
 * service-role store (intake-store.ts) enforces the SAME predicate at BOTH the
 * select and the delete, so a row that changes state between the two is never
 * removed. No new lifecycle status is introduced.
 */

export type CleanupStatus = 200 | 401 | 503;

/**
 * Authorize a cleanup request. Fail CLOSED: with no secret configured the
 * endpoint is disabled (503) — never open. A wrong/missing bearer is 401.
 * Mirrors the planner cron-route contract (shared bearer, not a user session).
 */
export function authorizeCleanup(
  authHeader: string | null | undefined,
  secret: string | undefined | null
): { ok: boolean; status: CleanupStatus } {
  if (!secret) return { ok: false, status: 503 }; // not configured → disabled
  if (authHeader !== `Bearer ${secret}`) return { ok: false, status: 401 };
  return { ok: true, status: 200 };
}

/** A single row's cleanup eligibility. Ambiguous expiry ⇒ preserve (fail safe). */
export function isStaleDraft(
  row: { status: string; token_expires_at: string } | null | undefined,
  now: Date = new Date()
): boolean {
  if (!row || row.status !== "draft") return false; // only live drafts
  const exp = Date.parse(row.token_expires_at);
  if (Number.isNaN(exp)) return false; // unparseable → do NOT delete
  return exp < now.getTime(); // token_expires_at < now()
}

/**
 * Injected data boundary. Both methods MUST filter by the exact eligibility
 * predicate (status='draft' AND token_expires_at < nowIso); `deleteDraftsByIds`
 * re-asserts it so a row that left `draft` after selection is not deleted, and
 * returns the count of rows ACTUALLY deleted.
 */
export interface CleanupStore {
  findExpiredDraftIds(nowIso: string, limit: number): Promise<string[]>;
  deleteDraftsByIds(ids: string[], nowIso: string): Promise<number>;
}

export interface CleanupResult {
  deleted: number;
  batches: number;
  /** true = the backlog was fully drained; false = hit the batch cap, more remain. */
  done: boolean;
}

export interface CleanupOptions {
  now?: Date;
  /** Rows per batch (bounds each DELETE). */
  batchSize?: number;
  /** Max batches per run (bounds total work so one tick can't run unboundedly). */
  maxBatches?: number;
}

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_BATCHES = 20;

/**
 * Idempotent, bounded cleanup pass. Deletes eligible rows in batches until the
 * backlog is empty or the batch cap is reached (the remainder drains on the next
 * scheduled tick). A run with nothing eligible deletes zero and reports done.
 */
export async function runCleanup(store: CleanupStore, opts: CleanupOptions = {}): Promise<CleanupResult> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const batchSize = Math.max(1, opts.batchSize ?? DEFAULT_BATCH_SIZE);
  const maxBatches = Math.max(1, opts.maxBatches ?? DEFAULT_MAX_BATCHES);

  let deleted = 0;
  let batches = 0;
  while (batches < maxBatches) {
    const ids = await store.findExpiredDraftIds(nowIso, batchSize);
    if (ids.length === 0) return { deleted, batches, done: true };
    deleted += await store.deleteDraftsByIds(ids, nowIso);
    batches += 1;
    if (ids.length < batchSize) return { deleted, batches, done: true }; // last partial batch
  }
  return { deleted, batches, done: false }; // hit the cap — more may remain for next tick
}
