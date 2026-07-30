import { projectEntity, type EngineDeps } from "./reconcile";

/**
 * REBUILD CONTRACT (documented in Stage 3.4; implemented in Stage 3.6).
 *
 * "Rebuild" re-projects Portal-managed events after a calendar/account change or
 * corruption of the reflected cache. It is a controlled, replay-safe operation —
 * NOT a destructive reset and NOT a blind duplicator. Exactly what it does:
 *
 *  1. SCOPE — Portal-managed only. It operates strictly on rows in
 *     calendar_projections (our projections). It NEVER enumerates, edits or
 *     deletes arbitrary Google events, and never touches an event we do not own
 *     a projection record for. Unrelated calendar events are left untouched.
 *
 *  2. EPOCH ADVANCE — for each in-scope projection it advances `id_epoch`, which
 *     mints a fresh deterministic event id. This sidesteps Google's restriction
 *     on reusing a just-deleted event id and guarantees a clean re-create rather
 *     than colliding with a stale id. The old google_event_id/etag/meet_url cache
 *     is cleared (it is only a cache — the event is reproducible from Portal
 *     data, per Reconstructability).
 *
 *  3. RE-PROJECT — it then drives the normal, idempotent reconciliation for each
 *     row (create under the new epoch). Because reconciliation is replay-safe,
 *     re-running rebuild is safe: an already-rebuilt row is a no-op.
 *
 *  4. SAFETY — bounded, resumable, and it never blocks Portal usage. A failure
 *     on one row does not abort the batch; the row is left pending for the
 *     scheduler. Optionally `dryRun` reports what WOULD change without calling
 *     Google.
 *
 *  5. AUDIT — it returns a per-item summary (reprojected / skipped / failed with
 *     sanitized reason) so an operator can see exactly what happened.
 *
 * This module intentionally contains only the contract + types in Stage 3.4.
 * The executable operation is added in Stage 3.6.
 */

export interface RebuildOptions {
  entityType?: "meeting";
  /** Report intended changes without calling Google. */
  dryRun?: boolean;
  /** Max projections to process in one pass. */
  limit?: number;
  /**
   * Advance id_epoch to mint fresh event ids (for a calendar/account change —
   * old-calendar events are intentionally abandoned). Default false: a safe
   * in-place re-sync that is duplicate-free and creates no orphans.
   */
  freshIds?: boolean;
}

export interface RebuildItemResult {
  entityId: string;
  action: "rebuilt" | "skipped" | "failed";
  /** Sanitized code only — never bodies, tokens or attendee data. */
  reason?: string;
}

/**
 * Structured audit summary returned to the admin (refinement 5) — never
 * free-form text. `items` carries per-entity outcomes with sanitized reasons.
 */
export interface RebuildSummary {
  processed: number;
  rebuilt: number;
  skipped: number;
  failed: number;
  durationMs: number;
  items: RebuildItemResult[];
}

/**
 * Execute the rebuild contract: enumerate Portal-managed projections, reset each
 * for rebuild (optionally advancing the epoch), and drive the normal idempotent
 * reconciliation. Replay-safe; never touches events we hold no projection for.
 * Returns the structured audit summary.
 */
export async function rebuildProjections(
  deps: EngineDeps,
  opts: RebuildOptions,
  correlationId: string
): Promise<RebuildSummary> {
  const start = deps.now().getTime();
  const recs = await deps.store.listAll(opts.limit ?? 500);
  const items: RebuildItemResult[] = [];
  let rebuilt = 0;
  let skipped = 0;
  let failed = 0;

  for (const rec of recs) {
    if (opts.entityType && rec.entityType !== opts.entityType) continue;

    if (opts.dryRun) {
      items.push({ entityId: rec.entityId, action: "skipped", reason: "dry_run" });
      skipped++;
      continue;
    }

    await deps.store.prepareRebuild(rec.id, opts.freshIds ?? false);
    const r = await projectEntity(
      deps,
      { entityType: rec.entityType, entityId: rec.entityId },
      correlationId
    );
    if (r.result === "success") {
      rebuilt++;
      items.push({ entityId: rec.entityId, action: "rebuilt" });
    } else if (r.result === "failure") {
      failed++;
      items.push({ entityId: rec.entityId, action: "failed", reason: r.reason });
    } else {
      skipped++;
      items.push({ entityId: rec.entityId, action: "skipped", reason: r.reason });
    }
  }

  return {
    processed: items.length,
    rebuilt,
    skipped,
    failed,
    durationMs: deps.now().getTime() - start,
    items,
  };
}
