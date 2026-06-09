import { createClient } from "@/lib/supabase/server";

/** A rep's own deals, newest first. RLS restricts to rep_id = auth.uid(). */
export async function getRepDeals(repId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("deals")
    .select("*")
    .eq("rep_id", repId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export interface RepStats {
  totalDeals: number;
  pipelineValue: number;
  awaitingApproval: number;
}

export async function getRepStats(repId: string): Promise<RepStats> {
  const deals = await getRepDeals(repId);
  return {
    totalDeals: deals.length,
    pipelineValue: deals.reduce((sum, d) => sum + (Number(d.price) || 0), 0),
    awaitingApproval: deals.filter((d) => d.status === "invoice_requested")
      .length,
  };
}
