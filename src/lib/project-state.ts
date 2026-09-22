/**
 * Canonical project-state derivation (CX1 — State Foundation). Pure, no I/O.
 *
 * `project_stages` is the single source of truth for project lifecycle state.
 * This module is the ONE place that interprets a client's stages, so every
 * client and admin surface consumes the same numbers/labels instead of each
 * deriving its own (which previously drifted). Client-facing labels resolve
 * through the presentation layer (journey.ts) so internal names never leak.
 *
 * Progress rule (deterministic, documented): progressPercent =
 * round(completedStages / totalStages * 100). A stage counts ONLY when its
 * status is `completed` — no half-credit for in-progress. The same stage data
 * always yields the same percentage everywhere.
 */
import { clientStageLabel, type JourneyStatus } from "./journey";

/** Minimal stage shape this module needs (satisfied by ProjectStage rows). */
export interface ProjectStageInput {
  name: string;
  status: string;
  position: number;
  target_date: string | null;
}

/** Internal stage names that carry lifecycle meaning (canonical, admin-side). */
export const LAUNCH_STAGE_NAME = "Launch";
export const REVIEW_STAGE_NAME = "Review Stage";

export interface ProjectStageView {
  /** Internal operational name — admin-only, never shown to a client. */
  internalName: string;
  /** Client-safe label (generic fallback for unmapped names). */
  label: string;
  status: JourneyStatus;
  position: number;
  targetDate: string | null;
}

export type ProjectLifecycle =
  | "no_project"
  | "not_started"
  | "in_progress"
  | "in_review"
  | "launched";

export interface ProjectState {
  hasStages: boolean;
  /** Stages ordered by position, with client-safe labels. */
  stages: ProjectStageView[];
  totalStages: number;
  completedStages: number;
  /** Deterministic completed/total percentage (0 when no stages). */
  progressPercent: number;
  /** 1-based ordinal of the current stage ("Stage X of Y"), or null. */
  currentPosition: number | null;
  current: ProjectStageView | null;
  /** First non-completed stage AFTER the current one, or null. */
  next: ProjectStageView | null;
  allComplete: boolean;
  /** Launch stage completed — the ONLY canonical signal that a site is live. */
  launched: boolean;
  lifecycle: ProjectLifecycle;
  /** Overall projected go-live date (clients.estimated_launch_date). */
  estimatedLaunchDate: string | null;
  /** Target date of the CURRENT stage only — never falls back to launch date. */
  currentStageTargetDate: string | null;
}

/** Deterministic progress: completed stages / total, rounded. No half-credit. */
export function stageProgressPercent(stages: { status: string }[]): number {
  if (stages.length === 0) return 0;
  const completed = stages.filter((s) => s.status === "completed").length;
  return Math.round((completed / stages.length) * 100);
}

/**
 * Interpret a client's project stages canonically. Robust to inconsistent data
 * (e.g. several stages flagged in_progress, or a completed stage after a pending
 * one): the current stage is deterministically the FIRST in_progress by position,
 * else the first pending, else the last stage; progress counts only completed
 * stages regardless of the active flags.
 */
export function canonicalProjectState(
  stages: readonly ProjectStageInput[],
  opts: { estimatedLaunchDate?: string | null } = {}
): ProjectState {
  const estimatedLaunchDate = opts.estimatedLaunchDate ?? null;

  const views: ProjectStageView[] = [...stages]
    .sort((a, b) => a.position - b.position)
    .map((s) => ({
      internalName: s.name,
      label: clientStageLabel(s.name),
      status: s.status as JourneyStatus,
      position: s.position,
      targetDate: s.target_date ?? null,
    }));

  const total = views.length;
  if (total === 0) {
    return {
      hasStages: false,
      stages: [],
      totalStages: 0,
      completedStages: 0,
      progressPercent: 0,
      currentPosition: null,
      current: null,
      next: null,
      allComplete: false,
      launched: false,
      lifecycle: "no_project",
      estimatedLaunchDate,
      currentStageTargetDate: null,
    };
  }

  const completed = views.filter((v) => v.status === "completed").length;
  const allComplete = completed === total;

  const current =
    views.find((v) => v.status === "in_progress") ??
    views.find((v) => v.status === "pending") ??
    views[total - 1];
  const currentIdx = views.indexOf(current);
  const next = views.slice(currentIdx + 1).find((v) => v.status !== "completed") ?? null;

  const launched = views.some(
    (v) => v.internalName === LAUNCH_STAGE_NAME && v.status === "completed"
  );
  const reviewActive = views.some(
    (v) => v.internalName === REVIEW_STAGE_NAME && v.status === "in_progress"
  );
  const anyStarted = views.some((v) => v.status === "in_progress" || v.status === "completed");
  const lifecycle: ProjectLifecycle = launched
    ? "launched"
    : reviewActive
      ? "in_review"
      : anyStarted
        ? "in_progress"
        : "not_started";

  return {
    hasStages: true,
    stages: views,
    totalStages: total,
    completedStages: completed,
    progressPercent: stageProgressPercent(views),
    currentPosition: currentIdx + 1,
    current,
    next,
    allComplete,
    launched,
    lifecycle,
    estimatedLaunchDate,
    currentStageTargetDate: current.targetDate,
  };
}
