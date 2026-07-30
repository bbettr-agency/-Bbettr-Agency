import type { ReconcileSummary } from "./reconcile";

/**
 * Scheduler abstraction (refinement 5).
 *
 * The reconciliation engine and application service know nothing about HOW a
 * due-reconciliation pass is triggered. A Scheduler adapter drives it on some
 * cadence — today a Supabase scheduled function calling the internal endpoint;
 * a future adapter (a queue, an external cron, a manual admin trigger) is a
 * drop-in replacement that changes ONLY the adapter, never the engine.
 *
 * Keep this interface intentionally tiny: one operation, "run one pass".
 */
export interface Scheduler {
  /** Run a single due-reconciliation pass and report what happened. */
  tick(correlationId: string): Promise<ReconcileSummary>;
}
