"use server";

import { revalidatePath } from "next/cache";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sendClientQuestionEmail } from "@/lib/email/client-notifications";
import { UPDATE_REACTION_EMOJIS } from "@/lib/update-reactions";
import type { QuestionChannel } from "@/lib/database.types";

export interface UpdateActionResult {
  ok?: boolean;
  error?: string;
}

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.bbettragency.com";

/**
 * Toggle the current client's emoji reaction on one of their updates. One
 * reaction per person per update: re-selecting the same emoji removes it,
 * a different emoji replaces it. RLS guarantees the client can only touch
 * their own rows; we also verify the update belongs to them.
 */
export async function toggleUpdateReactionAction(
  updateId: string,
  emoji: string
): Promise<UpdateActionResult> {
  const profile = await requireClient();
  if (!UPDATE_REACTION_EMOJIS.includes(emoji)) {
    return { error: "That reaction isn't available." };
  }

  const supabase = await createClient();
  const { data: update } = await supabase
    .from("updates")
    .select("id, client_id")
    .eq("id", updateId)
    .maybeSingle();
  if (!update || update.client_id !== profile.client_id) {
    return { error: "Update not found." };
  }

  const { data: existing } = await supabase
    .from("update_reactions")
    .select("id, emoji")
    .eq("update_id", updateId)
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (existing) {
    if (existing.emoji === emoji) {
      await supabase.from("update_reactions").delete().eq("id", existing.id);
    } else {
      await supabase
        .from("update_reactions")
        .update({ emoji })
        .eq("id", existing.id);
    }
  } else {
    const { error } = await supabase.from("update_reactions").insert({
      update_id: updateId,
      client_id: profile.client_id,
      profile_id: profile.id,
      emoji,
    });
    if (error) return { error: "Could not save your reaction." };
  }

  revalidatePath("/dashboard/updates");
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * The special ❓ "Question": record a one-off follow-up request (callback or
 * email) on an update and notify the team by email. This is NOT a comment
 * thread — it's a single structured request the team resolves.
 */
export async function requestUpdateFollowupAction(
  updateId: string,
  channel: QuestionChannel,
  message: string
): Promise<UpdateActionResult> {
  const profile = await requireClient();
  if (channel !== "callback" && channel !== "email") {
    return { error: "Choose a callback or an email." };
  }

  const supabase = await createClient();
  const { data: update } = await supabase
    .from("updates")
    .select("id, client_id, title")
    .eq("id", updateId)
    .maybeSingle();
  if (!update || update.client_id !== profile.client_id) {
    return { error: "Update not found." };
  }

  const trimmed = message.trim() || null;
  const { error } = await supabase.from("update_questions").insert({
    update_id: updateId,
    client_id: profile.client_id,
    profile_id: profile.id,
    channel,
    message: trimmed,
  });
  if (error) return { error: "Could not send your request. Please try again." };

  // Notify the team (best-effort — a missing email key never blocks the request).
  const { data: client } = await supabase
    .from("clients")
    .select("name, contact_name, contact_email, contact_phone")
    .eq("id", profile.client_id)
    .maybeSingle();

  await sendClientQuestionEmail({
    businessName: client?.name ?? "A client",
    contactName: client?.contact_name ?? null,
    contactEmail: client?.contact_email ?? null,
    contactPhone: client?.contact_phone ?? null,
    updateTitle: update.title,
    channel,
    message: trimmed,
    clientAdminUrl: `${APP_URL}/admin/clients/${profile.client_id}`,
  });

  revalidatePath("/dashboard/updates");
  return { ok: true };
}
