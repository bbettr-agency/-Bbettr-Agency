"use server";

import { revalidatePath } from "next/cache";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NOTIFY_SECTIONS, type NotifySection } from "@/lib/queries";

/**
 * Record that the client has just viewed a portal section, clearing its
 * notification dot. Writes the client's own row under their RLS — no service
 * role needed.
 */
export async function markSectionViewedAction(section: NotifySection) {
  const profile = await requireClient();
  if (!NOTIFY_SECTIONS.includes(section)) return;

  const supabase = await createClient();
  await supabase.from("client_section_views").upsert(
    {
      client_id: profile.client_id,
      section,
      last_viewed_at: new Date().toISOString(),
    },
    { onConflict: "client_id,section" }
  );

  // Refresh the layout so the sidebar dot clears.
  revalidatePath("/dashboard", "layout");
}
