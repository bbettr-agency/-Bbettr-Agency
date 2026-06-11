"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailService, type EmailKind } from "@/lib/email";
import { sendRepWelcomeEmail } from "@/lib/email/rep-notifications";
import { notifyAdmins } from "@/lib/internal-notifications";

export interface RepActionResult {
  ok?: boolean;
  error?: string;
  repId?: string;
  /** Generated temporary password, returned once for the admin to copy. */
  password?: string;
}

function genPassword(length = 14): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#$%";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

/**
 * Create a sales rep: provisions the auth login (role 'rep' via metadata, which
 * the handle_new_user trigger turns into a profile) and the rep metadata row.
 * Admin-only + service role. Returns a generated temp password to copy if the
 * admin didn't set one.
 */
export async function createRepAction(
  formData: FormData
): Promise<RepActionResult> {
  await requireAdmin();

  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const rateRaw = formData.get("commission_rate");
  const rate = rateRaw !== null && String(rateRaw) !== "" ? Number(rateRaw) : 0;
  let password = String(formData.get("password") ?? "");

  if (!fullName || !email) return { error: "Full name and email are required." };
  if (password && password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return { error: "Commission rate must be between 0 and 100." };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      error:
        "Server is missing its service-role key, so the rep login could not be created.",
    };
  }

  const generated = !password;
  if (!password) password = genPassword();

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: "rep" },
  });
  if (error || !created.user) {
    return { error: error?.message ?? "Could not create the rep login." };
  }

  const { error: repError } = await admin.from("reps").insert({
    id: created.user.id,
    display_name: fullName,
    phone: phone || null,
    commission_rate: rate,
    active: true,
  });
  if (repError) {
    return {
      ok: true,
      repId: created.user.id,
      error: `Rep login created, but their profile row failed: ${repError.message}`,
    };
  }

  await notifyAdmins({
    type: "rep_created",
    title: `New rep added — ${fullName}`,
    link: `/admin/reps/${created.user.id}`,
  });

  revalidatePath("/admin/reps");
  return { ok: true, repId: created.user.id, password: generated ? password : undefined };
}

/** Activate / deactivate a rep. */
export async function setRepActiveAction(
  repId: string,
  active: boolean
): Promise<RepActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("reps")
    .update({ active })
    .eq("id", repId);
  if (error) return { error: error.message };

  if (!active) {
    const { data: rep } = await supabase
      .from("reps")
      .select("display_name")
      .eq("id", repId)
      .maybeSingle();
    await notifyAdmins({
      type: "rep_deactivated",
      title: `Rep deactivated — ${rep?.display_name ?? "rep"}`,
      link: `/admin/reps/${repId}`,
    });
  }

  revalidatePath("/admin/reps");
  revalidatePath(`/admin/reps/${repId}`);
  return { ok: true };
}

/** Reset a rep's password to a fresh temporary one, returned once to copy. */
export async function resetRepPasswordAction(
  repId: string
): Promise<RepActionResult> {
  await requireAdmin();
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "Server is missing its service-role key." };
  }
  const password = genPassword();
  const { error } = await admin.auth.admin.updateUserById(repId, { password });
  if (error) return { error: error.message };
  return { ok: true, password };
}

/**
 * Send the rep a branded WELCOME email that includes their login credentials:
 * login URL, login email and the supplied temporary password.
 *
 * The password is provided by the caller — the one generated at creation or a
 * freshly reset/generated one. We never read a stored password (Supabase only
 * keeps the hash), so existing passwords are never exposed. If no password is
 * available the caller must reset/generate one first; this action refuses
 * without one.
 */
export async function sendRepWelcomeEmailAction(
  repId: string,
  password: string
): Promise<RepActionResult> {
  await requireAdmin();

  if (!password) {
    return {
      error:
        "Generate a temporary password first (Reset password), then send the welcome email so it can include login credentials.",
    };
  }

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", repId)
    .maybeSingle();
  if (!profile?.email) return { error: "This rep has no email on file." };

  const result = await sendRepWelcomeEmail({
    to: profile.email,
    name: profile.full_name,
    loginEmail: profile.email,
    password,
  });
  if (!result.ok) {
    return {
      error:
        result.error ??
        "Could not send the welcome email. Check the Resend configuration.",
    };
  }
  return { ok: true };
}

/** Send a rep a portal email (welcome / reset) via the shared email service. */
export async function sendRepEmailAction(
  repId: string,
  kind: EmailKind
): Promise<RepActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", repId)
    .maybeSingle();
  if (!profile?.email) return { error: "This rep has no email on file." };

  const result = await getEmailService().send(kind, profile.email);
  if (!result.ok) {
    return { error: result.error ?? "Could not send the email." };
  }
  return { ok: true };
}

/**
 * Permanently delete a rep — TESTING ONLY (later replaced by an Archive
 * workflow). Removes the auth login (so they can no longer sign in), which
 * cascades away EVERYTHING the rep owns; explicit deletes follow as a safety
 * net.
 *
 * Testing-only behaviour. Restore historical-data protection before production
 * launch. The previous version refused to delete a rep that had any deals,
 * invoice requests or commissions; that guard has been TEMPORARILY removed so
 * test reps can be cleaned up repeatedly. With it gone, this hard-deletes the
 * rep and all of their sales history.
 *
 * Deleting the auth user cascades (ON DELETE CASCADE), in order:
 *   auth.users → profiles → { reps, deals, invoice_requests, commissions,
 *   internal_notifications }  (deals also re-cascade their invoice_requests &
 *   commissions). The client-facing `notifications` table is tenant-addressed
 *   and holds no rep rows, so it is untouched.
 *
 * Requires admin + service role. `confirmationName` must match the rep's name
 * exactly (defence-in-depth on top of the UI's type-to-confirm).
 */
export async function deleteRepAction(
  repId: string,
  confirmationName: string
): Promise<RepActionResult> {
  await requireAdmin();

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      error:
        "Server is missing its service-role key, so the rep could not be deleted.",
    };
  }

  // 1. Verify the rep exists and the typed name matches exactly.
  const [{ data: rep }, { data: profile }] = await Promise.all([
    admin.from("reps").select("display_name").eq("id", repId).maybeSingle(),
    admin.from("profiles").select("full_name, role").eq("id", repId).maybeSingle(),
  ]);
  if (!rep && !profile) return { error: "Rep not found." };
  if (profile && profile.role !== "rep") {
    return { error: "This account is not a sales rep." };
  }
  const name = profile?.full_name || rep?.display_name || "Rep";
  if (confirmationName.trim() !== name) {
    return { error: "The name you typed does not match this rep." };
  }

  // 2. TESTING-ONLY: the historical-data guard has been removed on purpose so
  //    test reps (with deals / invoice requests / commissions) can be wiped.
  //    Restore historical-data protection before production launch.

  // 3. Delete the auth login first (so they can no longer sign in); this
  //    cascades the profile and ALL rep-owned rows (reps, deals,
  //    invoice_requests, commissions, internal_notifications). Explicit deletes
  //    follow as a safety net in case the cascade is ever unavailable.
  const { error: authError } = await admin.auth.admin.deleteUser(repId);
  if (authError) return { error: authError.message };
  await admin.from("reps").delete().eq("id", repId);
  await admin.from("profiles").delete().eq("id", repId);

  revalidatePath("/admin/reps");
  return { ok: true };
}
