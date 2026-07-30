import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentProfile } from "@/lib/auth";
import { isPlannerEnabled } from "@/lib/flags";
import { exchangeAndStore } from "@/lib/google";
import {
  IntegrationAuthError,
  logIntegrationEvent,
  newCorrelationId,
} from "@/lib/net";

/**
 * Google OAuth callback. Google redirects here with ?code and the ?state we
 * issued. We verify the admin session and the CSRF state, exchange the code for
 * tokens (refresh token stored encrypted, wrong accounts refused), then return
 * to the Integrations page with a status.
 */
export async function GET(request: Request) {
  if (!isPlannerEnabled()) {
    return NextResponse.redirect(new URL("/admin/integrations", request.url), {
      status: 302,
    });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const back = (status: string) =>
    NextResponse.redirect(
      new URL(`/admin/integrations?google=${status}`, request.url),
      { status: 302 }
    );

  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") {
    return NextResponse.redirect(new URL("/login", request.url), { status: 302 });
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("google_oauth_state")?.value;
  const correlationId =
    cookieStore.get("google_oauth_cid")?.value ?? newCorrelationId();

  const clearFlowCookies = (res: NextResponse) => {
    res.cookies.set("google_oauth_state", "", { path: "/", maxAge: 0 });
    res.cookies.set("google_oauth_cid", "", { path: "/", maxAge: 0 });
    return res;
  };

  // User declined consent on Google's side.
  if (oauthError) {
    logIntegrationEvent("info", {
      integration: "google",
      event: "oauth_callback",
      correlationId,
      outcome: "failure",
      reason: "consent_denied",
    });
    return clearFlowCookies(back("denied"));
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    logIntegrationEvent("warn", {
      integration: "google",
      event: "oauth_callback",
      correlationId,
      outcome: "failure",
      reason: "state_mismatch",
    });
    return clearFlowCookies(back("error"));
  }

  try {
    await exchangeAndStore(code, profile.id, correlationId);
    logIntegrationEvent("info", {
      integration: "google",
      event: "oauth_callback",
      correlationId,
      outcome: "success",
    });
    return clearFlowCookies(back("connected"));
  } catch (err) {
    // Wrong account / missing refresh token → a specific, actionable status.
    const wrongAccount =
      err instanceof IntegrationAuthError && err.code === "wrong_account";
    logIntegrationEvent("error", {
      integration: "google",
      event: "terminal_failure",
      correlationId,
      outcome: "failure",
      reason: wrongAccount ? "wrong_account" : "exchange_failed",
    });
    return clearFlowCookies(back(wrongAccount ? "wrong_account" : "error"));
  }
}
