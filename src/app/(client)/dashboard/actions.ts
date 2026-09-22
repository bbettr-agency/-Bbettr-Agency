"use server";

import { revalidatePath } from "next/cache";
import { requireClientWorkspace } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { advanceIntakeStatus } from "@/lib/intake-advance";
import { NOTIFY_SECTIONS, type NotifySection } from "@/lib/queries";

/**
 * D1: when a NEW client first reaches the portal at `portal_access_sent`, open
 * their onboarding (→ onboarding_started). Best-effort + guarded; a no-op for
 * legacy clients and anyone already past this step.
 */
export async function advanceIntakeOnLoginAction() {
  const { clientId } = await requireClientWorkspace();
  await advanceIntakeStatus(
    clientId,
    "onboarding_started",
    ["portal_access_sent"],
    { type: "onboarding_started", title: "Onboarding opened" }
  );
  revalidatePath("/dashboard", "layout");
}

/**
 * Record that the client has just viewed a portal section, clearing its
 * notification dot. Writes the client's own row under their RLS — no service
 * role needed.
 */
export async function markSectionViewedAction(section: NotifySection) {
  const { clientId } = await requireClientWorkspace();
  if (!NOTIFY_SECTIONS.includes(section)) return;

  const supabase = await createClient();
  await supabase.from("client_section_views").upsert(
    {
      client_id: clientId,
      section,
      last_viewed_at: new Date().toISOString(),
    },
    { onConflict: "client_id,section" }
  );

  // Refresh the layout so the sidebar dot clears.
  revalidatePath("/dashboard", "layout");
}

/**
 * Client marks one of their own action-required items as done. RLS ensures a
 * client can only resolve their own notifications.
 */
export async function resolveActionItemAction(notificationId: string) {
  const { clientId } = await requireClientWorkspace();
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("client_id", clientId);
  revalidatePath("/dashboard");
}

/** Mark a single notification as read (client's own, via RLS). */
export async function markNotificationReadAction(notificationId: string) {
  const { clientId } = await requireClientWorkspace();
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("client_id", clientId)
    .is("read_at", null);
  // Refresh the layout so the bell's unread count updates.
  revalidatePath("/dashboard", "layout");
}

/** Mark all of the client's unread notifications as read. */
export async function markAllNotificationsReadAction() {
  const { clientId } = await requireClientWorkspace();
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .is("read_at", null);
  revalidatePath("/dashboard", "layout");
}
