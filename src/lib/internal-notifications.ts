import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { InternalNotificationType } from "@/lib/database.types";

/**
 * Internal (admin/rep) in-app notifications — separate from the client-facing
 * `notifications` table. Writes go through the service-role client so a rep
 * action can notify admins (and vice-versa) regardless of RLS; all writes are
 * best-effort and never throw, so they can't break the triggering action.
 */

interface BaseInput {
  type: InternalNotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
}

/** Notify a single recipient (e.g. a rep). */
export async function notifyInternal(
  input: BaseInput & { recipientId: string }
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("internal_notifications").insert({
      recipient_id: input.recipientId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    });
  } catch {
    /* best-effort */
  }
}

/** Notify every admin (e.g. a rep submitted a deal). */
export async function notifyAdmins(input: BaseInput): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: admins } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "admin");
    if (!admins?.length) return;
    await admin.from("internal_notifications").insert(
      admins.map((a) => ({
        recipient_id: a.id,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
      }))
    );
  } catch {
    /* best-effort */
  }
}

export interface InternalFeedItem {
  id: string;
  type: InternalNotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface InternalFeed {
  items: InternalFeedItem[];
  unreadCount: number;
}

/** The current user's internal notification feed + unread count (own RLS). */
export async function getInternalFeed(
  userId: string,
  limit = 15
): Promise<InternalFeed> {
  const supabase = await createClient();
  const [{ data: items }, { count }] = await Promise.all([
    supabase
      .from("internal_notifications")
      .select("id, type, title, body, link, read_at, created_at")
      .eq("recipient_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("internal_notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", userId)
      .is("read_at", null),
  ]);
  return { items: items ?? [], unreadCount: count ?? 0 };
}
