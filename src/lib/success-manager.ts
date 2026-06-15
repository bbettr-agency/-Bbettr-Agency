import { createClient } from "@/lib/supabase/server";

/**
 * Success Manager resolution — settings-backed (the `team_members` table), never
 * hardcoded in components.
 *
 * Resolution order:
 *   1. the client's assigned `success_manager_id` (future per-client assignment)
 *   2. the default team member (`is_default = true`)
 *   3. a constant fallback (so the card never breaks if the table is empty)
 *
 * Runs under the caller's RLS — a client may read their assigned manager and the
 * default.
 */

export interface SuccessManager {
  name: string;
  role: string | null;
  email: string | null;
  whatsapp: string | null;
  photo_url: string | null;
  calendly_url: string | null;
}

/** Last-resort fallback, matching the seeded default. */
export const FALLBACK_SUCCESS_MANAGER: SuccessManager = {
  name: "Eloff Sander",
  role: "Co-Founder",
  email: "info@bbettragency.com",
  whatsapp: null,
  photo_url: null,
  calendly_url: null,
};

const SELECT = "name, role, email, whatsapp, photo_url, calendly_url";

export async function resolveSuccessManager(
  successManagerId: string | null
): Promise<SuccessManager> {
  const supabase = await createClient();

  if (successManagerId) {
    const { data } = await supabase
      .from("team_members")
      .select(SELECT)
      .eq("id", successManagerId)
      .maybeSingle();
    if (data) return data;
  }

  const { data: def } = await supabase
    .from("team_members")
    .select(SELECT)
    .eq("is_default", true)
    .maybeSingle();
  if (def) return def;

  return { ...FALLBACK_SUCCESS_MANAGER };
}
