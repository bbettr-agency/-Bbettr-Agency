"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface ResetState {
  error?: string;
}

/**
 * Set a new password using the RECOVERY SESSION established server-side by
 * /auth/confirm. Runs as the user's own session (anon client + cookies), never
 * service-role. Requires a valid session — if the recovery link was invalid /
 * expired / already used, there is no session and we return a clear message
 * instead of a vague failure. After a successful change we sign the recovery
 * session out so the user logs in fresh with the new password.
 */
export async function updatePasswordAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirm) return { error: "Passwords do not match." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: "Your reset link is invalid or has expired. Please request a new one.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  await supabase.auth.signOut();
  redirect("/login?reset=1");
}
