import type { DomainKey } from "./types";

/**
 * Jarvis Retrieval V2 — the LOCKED per-domain configuration (pure constants).
 *
 * One source of truth for the planner, budgeter and retrievers: which domains are
 * Portal operational (Pass-A always) vs on-demand, their detail row/token caps,
 * Pass-A summary token allowance, and the kept-first priority when trimming detail
 * under budget. Numbers per the approved Slice 1 plan (§11).
 */

export interface DomainConfig {
  /** Pass-A compact summary token allowance. */
  summaryTokens: number;
  /** Pass-B detail token budget. */
  detailTokens: number;
  /** Pass-B detail row cap. */
  detailLimit: number;
  /** Lower = kept first when trimming detail under budget. */
  priority: number;
  /** On-demand (PII / sensitivity) — never in a broad Pass A. */
  onDemand: boolean;
}

export const DOMAIN_CONFIG: Record<DomainKey, DomainConfig> = {
  client_identity: { summaryTokens: 260, detailTokens: 400, detailLimit: 1, priority: 1, onDemand: false },
  client_services: { summaryTokens: 200, detailTokens: 350, detailLimit: 8, priority: 2, onDemand: false },
  project_stages: { summaryTokens: 200, detailTokens: 350, detailLimit: 12, priority: 3, onDemand: false },
  updates: { summaryTokens: 180, detailTokens: 700, detailLimit: 5, priority: 4, onDemand: false },
  tasks: { summaryTokens: 180, detailTokens: 600, detailLimit: 10, priority: 5, onDemand: false },
  reports: { summaryTokens: 160, detailTokens: 700, detailLimit: 3, priority: 6, onDemand: false },
  onboarding: { summaryTokens: 180, detailTokens: 400, detailLimit: 8, priority: 7, onDemand: false },
  contracts: { summaryTokens: 140, detailTokens: 250, detailLimit: 5, priority: 8, onDemand: false },
  invoices: { summaryTokens: 200, detailTokens: 500, detailLimit: 8, priority: 9, onDemand: false },
  payments: { summaryTokens: 150, detailTokens: 350, detailLimit: 6, priority: 10, onDemand: false },
  retainers: { summaryTokens: 130, detailTokens: 200, detailLimit: 5, priority: 11, onDemand: false },
  activity: { summaryTokens: 150, detailTokens: 450, detailLimit: 8, priority: 12, onDemand: false },
  weekly_updates: { summaryTokens: 140, detailTokens: 350, detailLimit: 4, priority: 13, onDemand: false },
  deals: { summaryTokens: 140, detailTokens: 350, detailLimit: 3, priority: 14, onDemand: false },
  files: { summaryTokens: 150, detailTokens: 400, detailLimit: 10, priority: 15, onDemand: false },
  // Separate supplementary domain (own budget lane).
  memory: { summaryTokens: 200, detailTokens: 1500, detailLimit: 20, priority: 99, onDemand: false },
  // On-demand (PII / sensitivity) — only when a focus requires them.
  billing_details: { summaryTokens: 120, detailTokens: 300, detailLimit: 1, priority: 20, onDemand: true },
  update_questions: { summaryTokens: 120, detailTokens: 300, detailLimit: 5, priority: 21, onDemand: true },
  people: { summaryTokens: 120, detailTokens: 250, detailLimit: 6, priority: 22, onDemand: true },
};
