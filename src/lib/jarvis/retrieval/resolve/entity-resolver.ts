import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { EntityResolution, JarvisContext } from "@/lib/jarvis/retrieval/types";
import { resolveClientFromList, type ClientLike } from "./match";

/**
 * Resolve a user message to a Portal client, under the CALLER's RLS identity.
 * The principal is an admin, so RLS returns all clients they may read; a client
 * outside their read set never enters the candidate list (fail-safe). The only
 * ids used downstream are those returned here — never anything from the model.
 */
export async function resolveClientEntity(_ctx: JarvisContext, message: string): Promise<EntityResolution> {
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("id, name, company");
  const clients: ClientLike[] = (data ?? []).map((c) => ({
    id: c.id as string,
    name: (c.name as string | null) ?? "",
    company: (c.company as string | null) ?? null,
  }));
  return resolveClientFromList(message, clients);
}
