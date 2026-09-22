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

  // Existing portal user? (profiles is the app identity table; admin reads all.)
  const { data: existing } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // CASE A — attach a membership, idempotently. Nothing else about the user
    // changes (password, default workspace, other memberships all untouched).
    const { data: already } = await svc
      .from("client_members")
      .select("client_id")
      .eq("user_id", existing.id)
      .eq("client_id", clientId)
      .maybeSingle();
    if (already) {
      return { ok: true, outcome: "already_member", email };
    }
    const { error } = await svc
      .from("client_members")
      .insert({ user_id: existing.id, client_id: clientId });
    if (error) return { ok: false, error: "Could not grant access. Please try again." };

    await logActivity({
      clientId,
      type: "portal_access_granted",
      title: "Portal access granted",
      description: `Access granted to ${email}.`,
      visibility: "internal", // admin audit only — never the client feed
      createdBy: admin.id,
    });
    revalidatePath(`/admin/clients/${clientId}`);
    return { ok: true, outcome: "granted", email };
  }

  // CASE B — invite a brand-new portal user. The invite creates a STABLE auth
  // user id immediately; we then EXPLICITLY provision the profile + membership
  // from that id rather than trusting the DB trigger to have read client_id out
  // of the invite metadata (in production it did not, leaving the user with a
  // null default and ZERO memberships → the no-workspace redirect loop).
  const { data: inviteData, error: inviteErr } = await svc.auth.admin.inviteUserByEmail(email, {
    data: { full_name: null, role: "client", client_id: clientId },
    redirectTo: INVITE_REDIRECT,
  });

  if (inviteErr) {
    // The auth account already exists but our profiles-by-email lookup missed it
    // (e.g. a broken earlier invite left an account with no/empty profile). Find
    // it by id and provision, rather than creating a duplicate account.
    const authUserId = await findAuthUserIdByEmail(svc, email);
    if (authUserId) {
      await ensureClientProfileAndMembership(svc, authUserId, email, clientId);
      await logActivity({ clientId, type: "portal_access_granted", title: "Portal access granted", description: `Access granted to ${email}.`, visibility: "internal", createdBy: admin.id });
      revalidatePath(`/admin/clients/${clientId}`);
      return { ok: true, outcome: "granted", email };
    }
    return { ok: false, error: `Could not invite ${email}: ${inviteErr.message}` };
  }

  const newUserId = inviteData?.user?.id ?? null;
  if (!newUserId) {
    // Should not happen — the invite reported success but returned no user.
    return { ok: false, error: `Invitation to ${email} did not return an account. Please try again.` };
  }
  await ensureClientProfileAndMembership(svc, newUserId, email, clientId);

  await logActivity({
    clientId,
    type: "portal_invitation_sent",
    title: "Portal invitation sent",
    description: `Invitation sent to ${email}.`,
    visibility: "internal",
    createdBy: admin.id,
  });
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true, outcome: "invited", email };
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
async function ensureClientProfileAndMembership(
  svc: Svc,
  userId: string,
  email: string,
  clientId: string
): Promise<void> {
  const { data: prof } = await svc
    .from("profiles")
    .select("id, client_id, role")
    .eq("id", userId)
    .maybeSingle();

  if (!prof) {
    await svc.from("profiles").insert({ id: userId, email, role: "client", client_id: clientId });
  } else if (prof.client_id === null || prof.role !== "client") {
    // Fill a missing default / correct the role WITHOUT clobbering an existing
    // non-null default (that belongs to an already-provisioned user).
    const patch: { role: "client"; client_id?: string } = { role: "client" };
    if (prof.client_id === null) patch.client_id = clientId;
    await svc.from("profiles").update(patch).eq("id", userId);
  }

  await svc
    .from("client_members")
    .upsert({ user_id: userId, client_id: clientId }, { onConflict: "user_id,client_id", ignoreDuplicates: true });
}

/** Find an auth user id by email via the admin API (bounded pagination). */
async function findAuthUserIdByEmail(svc: Svc, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const match = data.users.find((u) => (u.email ?? "").trim().toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < 200) return null; // last page
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
