"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile, homePath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  ACTIVE_WORKSPACE_COOKIE,
  isSafeReturnPath,
} from "@/lib/active-workspace";

export interface SetWorkspaceResult {
  ok: boolean;
  error?: "not_a_client" | "not_a_member";
}

/**
 * Secure active-workspace setter (Membership S3) — the primitive the S4 switcher
 * will call. It records a PREFERENCE only; it never grants access.
 *
 * It MUST and DOES:
 *   1. authenticate the user (client role only; admins/reps are rejected);
 *   2. validate the target is one of THEIR OWN memberships — the client_members
 *      read runs under RLS (a user sees only their own rows), so a non-member
 *      target returns nothing and is rejected;
 *   3. store the preference in a server-managed, HttpOnly cookie;
 *   4. NEVER create/alter client_members and NEVER touch profiles.client_id;
 *   5. if a return path is supplied, only redirect to a same-origin path
 *      (open-redirect guarded) — otherwise it just returns.
 *
 * Authorization is unaffected: switching the displayed workspace cannot widen
 * what the database (S2 RLS) allows.
 */
export async function setActiveWorkspaceAction(
  clientId: string,
  returnPath?: string
): Promise<SetWorkspaceResult> {
  const profile = await requireProfile();
  if (profile.role !== "client") {
    // Admins/reps do not have client workspaces; never route them through this.
    return { ok: false, error: "not_a_client" };
  }

  // Membership check under RLS: this returns a row ONLY if the user genuinely
  // belongs to `clientId`. A workspace they are not a member of yields nothing.
  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("client_members")
    .select("client_id")
    .eq("client_id", clientId)
    .maybeSingle();
  if (!membership) return { ok: false, error: "not_a_member" };

  // Preference only — no authorization is stored here. Validated on every read.
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, clientId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // a year; still re-validated against memberships
  });

  // Re-render the whole client shell against the newly active workspace.
  revalidatePath("/", "layout");

  if (returnPath !== undefined) {
    redirect(isSafeReturnPath(returnPath) ? returnPath : "/dashboard");
  }
  return { ok: true };
}
