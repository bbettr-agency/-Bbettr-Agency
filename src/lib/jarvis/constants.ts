/**
 * Jarvis Foundation 1 — reserved constants.
 *
 * THE JARVIS SYSTEM ACTOR IS PROVENANCE, NOT AUTHORITY. This reserved uuid only
 * stamps `actor_kind='jarvis'` on audit/proposals so we can attribute
 * proactive/system-originated activity. It is a NON-LOGIN identity: it is never
 * inserted into auth.users or profiles, can never authenticate, and NEVER grants
 * any capability. Authority always derives from the authenticated human
 * principal + capability grants + deterministic policy + required approval +
 * scope validation. (Mirrors the reserved agency-workspace seed convention.)
 */
export const JARVIS_SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-0000000004a1" as const;

/** Grant key that marks a profile as Jarvis-enabled at all (gate to any use). */
export const GRANT_JARVIS_USE = "jarvis.use" as const;

/** Grant key for approval authority (who may approve confirm/destructive actions). */
export const GRANT_JARVIS_APPROVE = "jarvis.approve" as const;

/** Proposal freshness window: an approval/proposal older than this is stale. */
export const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000; // 24h
