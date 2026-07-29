import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getCurrentProfile } from "@/lib/auth";
import { PLANNER_ENABLED } from "@/lib/flags";
import { getGoogleAuthorizeUrl, isGoogleConfigured } from "@/lib/google";
import { logIntegrationEvent, newCorrelationId } from "@/lib/net";

/**
 * Start the Google Calendar OAuth flow. Admin-only, gated by PLANNER_ENABLED.
 * Generates a CSRF `state` + a correlation id (both httpOnly cookies), and
 * redirects the browser to Google's consent page.
 */
export async function GET(request: Request) {
  // Feature-flagged internal module: when off, the surface simply doesn't exist.
  if (!PLANNER_ENABLED) {
    return NextResponse.redirect(new URL("/admin/integrations", request.url), {
      status: 302,
    });
  }

  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") {
    return NextResponse.redirect(new URL("/login", request.url), { status: 302 });
  }

  const correlationId = newCorrelationId();

  if (!isGoogleConfigured()) {
    logIntegrationEvent("warn", {
      integration: "google",
      event: "oauth_start",
      correlationId,
      outcome: "failure",
      reason: "not_configured",
    });
    return NextResponse.redirect(
      new URL("/admin/integrations?google=not_configured", request.url),
      { status: 302 }
    );
  }

  const state = randomBytes(16).toString("hex");
  const url = getGoogleAuthorizeUrl(state);
  if (!url) {
    return NextResponse.redirect(
      new URL("/admin/integrations?google=not_configured", request.url),
      { status: 302 }
    );
  }

  logIntegrationEvent("info", {
    integration: "google",
    event: "oauth_start",
    correlationId,
    outcome: "start",
  });

  const res = NextResponse.redirect(url, { status: 302 });
  const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600, // 10 minutes
  };
  res.cookies.set("google_oauth_state", state, cookieOpts);
  res.cookies.set("google_oauth_cid", correlationId, cookieOpts);
  return res;
}
