import "server-only";

import type { RetrieverContext } from "../types";

/**
 * Client discovery ("who are all our clients?"). Distinct from bounded per-client
 * evidence: returns the COMPLETE authorized client list up to a deterministic
 * threshold, and beyond it discloses truncation explicitly (never silent omission).
 * Runs under the caller's RLS identity (admin sees all authorized clients).
 *
 * Counting and grouping are done HERE, deterministically, so the model only presents
 * the numbers — it must never count or group raw rows itself.
 */

export const DISCOVERY_FULL_LIMIT = 50;

export interface DiscoveryClient {
  id: string;
  name: string;
  status: string;
}

export interface DiscoveryGroup {
  status: string;
  count: number;
  clients: DiscoveryClient[];
}

export interface DiscoveryResult {
  groups: DiscoveryGroup[];
  /** Total authorized clients (exact DB count). */
  total: number;
  /** How many rows were retrieved + grouped (== sum of group counts). */
  shown: number;
  truncated: boolean;
  status: "ok" | "empty" | "error";
}

/** Group retrieved clients by status, deterministically (stable status order, then name). */
function groupByStatus(clients: DiscoveryClient[]): DiscoveryGroup[] {
  const byStatus = new Map<string, DiscoveryClient[]>();
  for (const c of clients) {
    const arr = byStatus.get(c.status) ?? [];
    arr.push(c);
    byStatus.set(c.status, arr);
  }
  return [...byStatus.entries()]
    .map(([status, cs]) => ({
      status,
      count: cs.length,
      clients: cs.slice().sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.status.localeCompare(b.status));
}

export async function retrieveClientDiscovery(rc: RetrieverContext): Promise<DiscoveryResult> {
  try {
    const { data, count } = await rc.supabase
      .from("clients")
      .select("id, name, status", { count: "exact" })
      .order("status", { ascending: true })
      .order("name", { ascending: true })
      .limit(DISCOVERY_FULL_LIMIT);
    const rows = (data ?? []).map((r) => ({
      id: r.id as string,
      name: (r.name as string | null) ?? "",
      status: String(r.status),
    }));
    const total = count ?? rows.length;
    return {
      groups: groupByStatus(rows),
      total,
      shown: rows.length,
      truncated: total > rows.length,
      status: rows.length === 0 ? "empty" : "ok",
    };
  } catch {
    return { groups: [], total: 0, shown: 0, truncated: false, status: "error" };
  }
}
