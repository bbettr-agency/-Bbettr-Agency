import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentProfile } from "@/lib/auth";
import { exchangeAndStore } from "@/lib/quickbooks";

/**
 * QuickBooks OAuth callback. Intuit redirects here with ?code, ?realmId and the
 * ?state we issued. We verify the admin session and the CSRF state, exchange the
 * code for tokens (stored encrypted), then return to the Integrations page.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const realmId = searchParams.get("realmId");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const back = (status: string) =>
    NextResponse.redirect(
      new URL(`/admin/integrations?qbo=${status}`, request.url),
      { status: 302 }
    );

  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") {
    return NextResponse.redirect(new URL("/login", request.url), { status: 302 });
  }

  // User declined consent on Intuit's side.
  if (error) return back("denied");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("qbo_oauth_state")?.value;
  const clearState = (res: NextResponse) => {
    res.cookies.set("qbo_oauth_state", "", { path: "/", maxAge: 0 });
    return res;
  };

  if (!code || !realmId || !state || !expectedState || state !== expectedState) {
    return clearState(back("error"));
  }

  try {
    await exchangeAndStore(code, realmId, profile.id);
    return clearState(back("connected"));
  } catch {
    return clearState(back("error"));
  }
}
