/**
 * Route prefixes reachable WITHOUT an authenticated portal session. The Edge
 * middleware skips its login redirect for these; every other route stays gated
 * (and each route group's server layout independently enforces auth). Keep this
 * list tight — each entry widens the unauthenticated surface.
 */
export const PUBLIC_ROUTES = [
  "/login",
  "/auth",
  "/forgot-password",
  "/reset-password",
  // Public legal pages — reachable without a portal session, and used as the
  // Google OAuth app's Privacy Policy / Terms of Service URLs.
  "/privacy",
  "/terms",
  // PayFast checkout hand-off + return/cancel + ITN — hit by the international
  // payer, who is not a logged-in portal user.
  "/pay",
  "/api/payfast",
  // Public self-service meeting rescheduling. Authorized solely by the secure
  // token in the URL path (/reschedule/<token>).
  "/reschedule",
] as const;

/** Is `pathname` under a public prefix? Prefix match, like the middleware. */
export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname.startsWith(route));
}
