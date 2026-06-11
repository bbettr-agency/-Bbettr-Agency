import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getCurrentProfile } from "@/lib/auth";
import { getAuthorizeUrl, isQboConfigured } from "@/lib/quickbooks";

/**
 * Start the QuickBooks OAuth flow. Admin-only. Generates a CSRF `state`, stores
 * it in an httpOnly cookie, and redirects the browser to Intuit's consent page.
 */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") {
    return NextResponse.redirect(new URL("/login", request.url), { status: 302 });
  }
  if (!isQboConfigured()) {
    return NextResponse.redirect(
      new URL("/admin/integrations?qbo=not_configured", request.url),
      { status: 302 }
    );
  }

  const state = randomBytes(16).toString("hex");
  const url = getAuthorizeUrl(state);
  if (!url) {
    return NextResponse.redirect(
      new URL("/admin/integrations?qbo=not_configured", request.url),
      { status: 302 }
    );
  }

  const res = NextResponse.redirect(url, { status: 302 });
  res.cookies.set("qbo_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes
  });
  return res;
}
