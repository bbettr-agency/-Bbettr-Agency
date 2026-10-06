import "server-only";

import type { RetrieverContext } from "../types";

/**
 * Client discovery ("who are all our clients?"). Distinct from bounded per-client
 * evidence: returns the COMPLETE authorized client list up to a deterministic
 * threshold, and beyond it discloses truncation explicitly (never silent omission).
 * Runs under the caller's RLS identity (admin sees all authorized clients).
 */

export const DISCOVERY_FULL_LIMIT = 50;

export interface DiscoveryClient {
  id: string;
  name: string;
  status: string;
}

export interface DiscoveryResult {
  clients: DiscoveryClient[];
  total: number;
  truncated: boolean;
  status: "ok" | "empty" | "error";
}

export async function retrieveClientDiscovery(rc: RetrieverContext): Promise<DiscoveryResult> {
  try {
    const { data, count } = await rc.supabase
      .from("clients")
      .select("id, name, status", { count: "exact" })
      .order("status", { ascending: true })
      .order("name", { ascending: true })
      .limit(DISCOVERY_FULL_LIMIT);
    const rows = data ?? [];
    const total = count ?? rows.length;
    return {
      clients: rows.map((r) => ({ id: r.id as string, name: (r.name as string | null) ?? "", status: String(r.status) })),
      total,
      truncated: total > rows.length,
      status: rows.length === 0 ? "empty" : "ok",
    };
  } catch {
    return { clients: [], total: 0, truncated: false, status: "error" };
  }
}
