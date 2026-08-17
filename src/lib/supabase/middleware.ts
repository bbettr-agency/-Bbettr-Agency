import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isPublicRoute } from "./public-routes";

/** Hard cap on the Edge auth call so a slow auth server can't 504 the site. */
const AUTH_TIMEOUT_MS = 2500;

/**
 * Resolve `promise`, or reject after `ms`. The timer is always cleared, so a
 * fast result never leaves a dangling rejection.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("auth-timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Refreshes the Supabase session on every request and enforces route-level
 * auth. Unauthenticated users are redirected to /login; authenticated users
 * hitting /login are bounced to the app root which routes by role.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not run code between createServerClient and getUser().
  //
  // Refresh the session, but NEVER let a slow/unreachable auth server hang the
  // Edge middleware — a hang here 504s the ENTIRE site (every route runs through
  // middleware first). If the auth check can't resolve in time we treat the auth
  // state as "unknown" and skip the middleware redirects: the request still
  // renders, and each route group's server layout (requireClient / requireAdmin
  // / requireRep) independently enforces auth, so protected content is never
  // exposed. The site degrades gracefully instead of going fully dark.
  let user: User | null = null;
  let authKnown = true;
  try {
    const { data } = await withTimeout(supabase.auth.getUser(), AUTH_TIMEOUT_MS);
    user = data.user;
  } catch {
    authKnown = false;
  }

  const { pathname } = request.nextUrl;
  const isPublic = isPublicRoute(pathname);

  // Only apply redirects when the auth state is actually known.
  if (authKnown) {
    if (!user && !isPublic) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("redirectedFrom", pathname);
      return NextResponse.redirect(url);
    }

    if (user && pathname === "/login") {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
