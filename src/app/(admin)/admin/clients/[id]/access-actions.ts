"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailService } from "@/lib/email";
import { logActivity } from "@/lib/activity";
import {
  normalizeEmail,
  isValidEmail,
  decideDefaultAfterRevoke,
  type GrantResult,
} from "@/lib/portal-access";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.bbettragency.com";

/** Invitees land on the S0 device-independent confirm route, then set a password. */
const INVITE_REDIRECT = `${APP_URL}/auth/confirm?next=/reset-password`;

export interface RevokeResult {
  ok: boolean;
  error?: string;
  /** Memberships the user has LEFT after the revoke (0 → routed to no_client). */
  remaining?: number;
}

/**
 * Grant a person portal access to THIS client workspace by email (S4A).
 *
 * Admin-only. A portal USER is not a workspace, so:
 *   • CASE A — an account already exists for the email → ADD a client_members
 *     row for it (idempotent). We never create a second auth account, never
 *     touch their password, other memberships, or their legacy default
 *     (profiles.client_id).
 *   • CASE B — no account exists → INVITE the email via the Supabase admin API.
 *     The invite creates a STABLE user id immediately, so handle_new_user makes
 *     the profile (client_id = this workspace → the invitee's legacy default)
 *     and the S1 sync trigger mints the membership — no pending record needed.
 *     No password is ever generated, emailed, or stored; the invitee sets their
 *     own via the S0 confirm → reset-password flow.
 *
 * All privileged writes go through the service-role client AFTER requireAdmin.
 */
export async function grantWorkspaceAccessAction(
  clientId: string,
  rawEmail: string
): Promise<GrantResult> {
  const admin = await requireAdmin();
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return { ok: false, error: "Please enter a valid email address." };

  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return { ok: false, error: "That client workspace no longer exists." };

  let svc;
  try {
    svc = createAdminClient();
  } catch {
    return { ok: false, error: "Server is missing its service-role key, so access can't be managed." };
  }

  try {
    // Decide identity from the AUTHORITATIVE store (auth.users) via the Admin
    // API — NEVER from profiles.email, which can be missing/incomplete/null for
    // a half-provisioned account and must not be mistaken for "no Auth user".
    const authUser = await findAuthUserByEmail(svc, email);

    if (authUser) {
      // ── Existing Auth identity → inspect + repair the portal profile, then
      //    attach the membership. NEVER invite (the account already has
      //    credentials), never change the password. ──────────────────────────
      const { data: prof, error: profErr } = await svc
        .from("profiles")
        .select("id, role, client_id, email")
        .eq("id", authUser.id)
        .maybeSingle();
      if (profErr) throw new Error(`profile lookup failed: ${profErr.message}`);

      // Role safety: never convert an internal (admin/rep) user into a client.
      if (prof && prof.role !== "client") {
        return {
          ok: false,
          error:
            "This email belongs to an internal Bbettr user and can’t be added as a client workspace member here.",
        };
      }

      // Already has access → idempotent success.
      const { data: already } = await svc
        .from("client_members")
        .select("client_id")
        .eq("user_id", authUser.id)
        .eq("client_id", clientId)
        .maybeSingle();
      if (already) return { ok: true, outcome: "already_member", email };

      // Was the portal identity incomplete (missing/empty profile)? Then this is
      // a repair, not a plain grant.
      const wasIncomplete =
        !prof || prof.client_id === null || (prof.email ?? "") !== email;

      await ensureClientProfileAndMembership(svc, authUser.id, authUser.email ?? email, clientId);

      await logActivity({
        clientId,
        type: "portal_access_granted",
        title: "Portal access granted",
        description: `Access granted to ${email}.`,
        visibility: "internal", // admin audit only — never the client feed
        createdBy: admin.id,
      });
      revalidatePath(`/admin/clients/${clientId}`);
      return { ok: true, outcome: wasIncomplete ? "repaired" : "granted", email };
    }

    // ── No Auth identity → invite a brand-new user, then EXPLICITLY provision
    //    the profile + membership from the returned stable user id (not trusting
    //    the invite metadata trigger path). No password is generated/emailed. ──
    const { data: inviteData, error: inviteErr } = await svc.auth.admin.inviteUserByEmail(email, {
      data: { full_name: null, role: "client", client_id: clientId },
      redirectTo: INVITE_REDIRECT,
    });

    // Race / already-exists fallback: if the invite failed or returned no user,
    // re-resolve the Auth identity (it may have been created concurrently) and
    // provision it rather than creating a duplicate account.
    const newUserId =
      inviteData?.user?.id ?? (await findAuthUserByEmail(svc, email))?.id ?? null;
    if (!newUserId) {
      console.error("[grantWorkspaceAccess] invite produced no user", {
        clientId,
        emailDomain: email.split("@")[1] ?? null,
        inviteError: inviteErr?.message ?? null,
      });
      return {
        ok: false,
        error: "Unable to provision portal access — please check the server logs.",
      };
    }

    const created = !inviteErr && inviteData?.user?.id;
    await ensureClientProfileAndMembership(svc, newUserId, email, clientId);

    await logActivity({
      clientId,
      type: created ? "portal_invitation_sent" : "portal_access_granted",
      title: created ? "Portal invitation sent" : "Portal access granted",
      description: created ? `Invitation sent to ${email}.` : `Access granted to ${email}.`,
      visibility: "internal",
      createdBy: admin.id,
    });
    revalidatePath(`/admin/clients/${clientId}`);
    return { ok: true, outcome: created ? "invited" : "repaired", email };
  } catch (e) {
    // Never leak raw Supabase/Auth errors to the browser; keep a useful server
    // diagnostic so a residual environment issue (e.g. schema cache) is visible.
    console.error("[grantWorkspaceAccess] unexpected error", {
      clientId,
      emailDomain: email.split("@")[1] ?? null,
      error: e instanceof Error ? e.message : String(e),
    });
    return {
      ok: false,
      error: "Unable to provision portal access — please check the server logs.",
    };
  }
}

type Svc = ReturnType<typeof createAdminClient>;

/**
 * Idempotently guarantee that `userId` has a client-role profile whose legacy
 * default is set (if it was missing) and a membership to `clientId`. Uses the
 * service role. Safety rules:
 *   • creates the profile if it is missing (brand-new invitee);
 *   • sets the profile's default (client_id) ONLY when it is currently null, so
 *     an EXISTING user's real default is never overwritten;
 *   • ensures the (user_id, client_id) membership, on-conflict-safe.
 * The membership is what authorizes access (S2) and lets S3 resolve a workspace.
 */
/**
 * Thrown when a grant write fails or cannot be verified. The action's catch
 * logs `.message` server-side and returns a generic, safe message to the admin,
 * so raw Supabase details never reach the browser and success is NEVER reported
 * for an unpersisted membership.
 */
class GrantPersistenceError extends Error {}

async function ensureClientProfileAndMembership(
  svc: Svc,
  userId: string,
  email: string,
  clientId: string
): Promise<void> {
  // 1) Read the current profile (fail hard on a read error — we must not guess).
  const { data: prof, error: profReadErr } = await svc
    .from("profiles")
    .select("id, client_id, role, email")
    .eq("id", userId)
    .maybeSingle();
  if (profReadErr) throw new GrantPersistenceError(`profile read failed: ${profReadErr.message}`);

  // 2) Create or repair the profile — inspect EVERY write's error.
  if (!prof) {
    const { error } = await svc
      .from("profiles")
      .insert({ id: userId, email, role: "client", client_id: clientId });
    if (error) throw new GrantPersistenceError(`profile insert failed: ${error.message}`);
  } else {
    // Repair an incomplete profile WITHOUT clobbering a healthy one: fill a
    // missing default, a missing/mismatched email, or a non-client role (the
    // caller has already refused genuine admin/rep identities).
    const patch: { role?: "client"; client_id?: string; email?: string } = {};
    if (prof.role !== "client") patch.role = "client";
    if (prof.client_id === null) patch.client_id = clientId;
    if ((prof.email ?? "") !== email) patch.email = email;
    if (Object.keys(patch).length > 0) {
      const { error } = await svc.from("profiles").update(patch).eq("id", userId);
      if (error) throw new GrantPersistenceError(`profile update failed: ${error.message}`);
    }
  }

  // 3) Ensure the membership — inspect the write's error.
  const { error: memErr } = await svc
    .from("client_members")
    .upsert({ user_id: userId, client_id: clientId }, { onConflict: "user_id,client_id", ignoreDuplicates: true });
  if (memErr) throw new GrantPersistenceError(`membership upsert failed: ${memErr.message}`);

  // 4) READ-AFTER-WRITE: the exact (user_id, client_id) row MUST now exist.
  //    This is the authoritative gate — success is only reported after this
  //    confirms persistence (guards against a silently-dropped write / cache).
  const { data: confirmed, error: confErr } = await svc
    .from("client_members")
    .select("user_id, client_id")
    .eq("user_id", userId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (confErr) throw new GrantPersistenceError(`membership verification read failed: ${confErr.message}`);
  if (!confirmed) {
    throw new GrantPersistenceError("membership verification failed: row not found after write");
  }
}

interface AuthIdentity {
  id: string;
  email: string | null;
}

/**
 * Find an existing Auth user by normalized email via the Admin API (the
 * authoritative identity store). supabase-js exposes no direct get-by-email, so
 * we page listUsers (case-insensitive match), bounded for our portal size.
 * Service-role only; never exposed to clients. Returns null when no Auth
 * identity exists — which is the ONLY signal that should trigger an invite.
 */
async function findAuthUserByEmail(svc: Svc, email: string): Promise<AuthIdentity | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const match = data.users.find((u) => (u.email ?? "").trim().toLowerCase() === email);
    if (match) return { id: match.id, email: match.email ?? null };
    if (data.users.length < 200) return null; // last page reached
  }
  return null;
}

/**
 * Revoke a user's membership to THIS workspace (S4A). Admin-only. Removes ONLY
 * that (user_id, client_id) row — never the auth user, their profile, their
 * other memberships, or their password. If the revoked workspace was the user's
 * legacy default (profiles.client_id), the default is reassigned to a
 * deterministic remaining membership (or NULL if none remain) so S3 resolution
 * stays coherent. A user left with zero memberships simply routes to no_client
 * on next resolution — their account is preserved.
 */
export async function revokeWorkspaceAccessAction(
  clientId: string,
  userId: string
): Promise<RevokeResult> {
  const admin = await requireAdmin();

  let svc;
  try {
    svc = createAdminClient();
  } catch {
    return { ok: false, error: "Server is missing its service-role key, so access can't be managed." };
  }

  const { data: mems } = await svc
    .from("client_members")
    .select("client_id")
    .eq("user_id", userId);
  const memberships = (mems ?? []).map((r) => r.client_id as string);
  if (!memberships.includes(clientId)) {
    return { ok: true, remaining: memberships.length }; // already not a member — idempotent
  }

  // Remove ONLY this membership pair.
  const { error: delErr } = await svc
    .from("client_members")
    .delete()
    .eq("user_id", userId)
    .eq("client_id", clientId);
  if (delErr) return { ok: false, error: "Could not revoke access. Please try again." };

  const remaining = memberships.filter((id) => id !== clientId);

  // Keep the legacy/default workspace coherent (privileged path — service role).
  const { data: prof } = await svc
    .from("profiles")
    .select("client_id")
    .eq("id", userId)
    .maybeSingle();
  const decision = decideDefaultAfterRevoke({
    currentDefault: (prof?.client_id as string | null) ?? null,
    revokedClientId: clientId,
    remainingMemberships: remaining,
  });
  if (decision.changed) {
    await svc.from("profiles").update({ client_id: decision.newDefault }).eq("id", userId);
  }

  await logActivity({
    clientId,
    type: "portal_access_revoked",
    title: "Portal access revoked",
    description: `Access revoked for a portal user.`,
    visibility: "internal",
    createdBy: admin.id,
  });
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true, remaining: remaining.length };
}

/**
 * Trigger the existing (S0) self-serve password-reset email for a member. Admin-
 * only. Bbettr never sets, sees, retrieves, or emails a plaintext password — the
 * user chooses their own via the secure recovery flow.
 */
export async function sendMemberPasswordResetAction(
  clientId: string,
  rawEmail: string
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return { ok: false, error: "Invalid email address." };

  const result = await getEmailService().send("password_reset", email);
  if (!result.ok) return { ok: false, error: result.error ?? "Could not send the reset email." };
  return { ok: true };
}
