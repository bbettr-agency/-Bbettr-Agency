import "server-only";

/**
 * Server-side feature flags for staged rollout of Portal modules.
 *
 * PLANNER_ENABLED — the internal, admin-only Planner module (Bbettr OS
 * integration: tasks + meetings + Google Calendar) is built and shipped behind
 * this flag, phase by phase, and only revealed to the team once complete.
 *
 * READ AT REQUEST TIME. `isPlannerEnabled()` reads process.env on every call —
 * NOT a module-level constant captured once at import. This guarantees the
 * deployed runtime environment is always authoritative: setting the env var and
 * redeploying reliably takes effect, with no build-time value capture.
 *
 * This flag is the global ON/OFF switch, NOT the security boundary: admin-only
 * access is enforced independently by requireAdmin() + RLS + the (admin) route
 * group. A flag being on never grants a client or rep any access.
 *
 * Server-only by design — an internal admin capability has no reason to ship in
 * the browser bundle. It is read in server components / server actions / route
 * handlers; the client-rendered AppShell receives a resolved capability boolean
 * as a prop from the server layout, never by importing this module. `server-only`
 * makes an accidental client import a build error.
 *
 * Absent or anything other than "true" ⇒ off.
 */
export function isPlannerEnabled(): boolean {
  return process.env.PLANNER_ENABLED === "true";
}
