import "server-only";

import { createClient } from "@/lib/supabase/server";
import { expandGrantKeys } from "./bundles";

/**
 * Resolve a principal's EFFECTIVE Jarvis grant keys (Foundation 1). Reads the
 * stored grant rows for (user, agency workspace) under the caller's RLS (admins
 * may read grants in their workspace) and expands any bundles. Default-deny:
 * absent rows ⇒ empty set. Server-only.
 */
export async function resolveEffectiveGrants(
  userId: string,
  workspaceId: string
): Promise<Set<string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jarvis_capability_grants")
    .select("grant_key")
    .eq("subject_user_id", userId)
    .eq("workspace_id", workspaceId);
  return expandGrantKeys((data ?? []).map((r) => r.grant_key as string));
}
