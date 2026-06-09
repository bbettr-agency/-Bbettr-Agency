"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailService, type EmailKind } from "@/lib/email";

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
