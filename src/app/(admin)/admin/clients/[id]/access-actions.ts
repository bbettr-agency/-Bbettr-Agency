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

  // CASE B — invite a brand-new portal user; membership follows automatically.
  const { error: inviteErr } = await svc.auth.admin.inviteUserByEmail(email, {
    data: { full_name: null, role: "client", client_id: clientId },
    redirectTo: INVITE_REDIRECT,
  });
  if (inviteErr) {
    // Rare: the auth account exists but had no profile row (so our lookup
    // missed it). Re-check profiles rather than creating a duplicate account.
    const { data: retry } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
      .limit(1)
      .maybeSingle();
    if (retry) {
      const { error } = await svc
        .from("client_members")
        .insert({ user_id: retry.id, client_id: clientId });
      if (!error) {
        await logActivity({ clientId, type: "portal_access_granted", title: "Portal access granted", description: `Access granted to ${email}.`, visibility: "internal", createdBy: admin.id });
        revalidatePath(`/admin/clients/${clientId}`);
        return { ok: true, outcome: "granted", email };
      }
    }
    return { ok: false, error: `Could not invite ${email}: ${inviteErr.message}` };
  }

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
