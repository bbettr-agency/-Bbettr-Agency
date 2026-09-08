import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProspectIntakeStore, StoredIntake } from "./intake-server";
import type { PromotedColumns } from "./intake-normalize";

/**
 * Real service-role ProspectIntakeStore (P2-C). The ONLY place public-intake DB
 * writes happen — always server-side, after the service layer's honeypot /
 * Turnstile / token / validation gates. token_hash is the lookup key; the raw
 * token is never stored. Guarded updates + the atomic submit claim run as
 * conditional `WHERE ... status='draft'` updates (RETURNING via .select()).
 */
const TABLE = "prospect_intakes";
const columnsPatch = (c: PromotedColumns) => ({
  business_name: c.business_name,
  contact_name: c.contact_name,
  email: c.email,
  phone: c.phone,
  selected_services: c.selected_services,
});

export function createProspectIntakeStore(): ProspectIntakeStore {
  const admin = createAdminClient();
  return {
    async insertDraft(input) {
      const { data, error } = await admin
        .from(TABLE)
        .insert({
          token_hash: input.token_hash,
          token_expires_at: input.token_expires_at,
          source: input.source,
          status: "draft",
          data: input.data,
          ...columnsPatch(input.columns),
        })
        .select("id")
        .single();
      if (error || !data) throw new Error("insert_failed");
      return { id: data.id as string };
    },

    async findByTokenHash(tokenHash) {
      const { data } = await admin
        .from(TABLE)
        .select("id, status, source, token_expires_at, data")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      return (data as StoredIntake | null) ?? null;
    },

    async updateDraftData(id, data, columns) {
      const { data: row } = await admin
        .from(TABLE)
        .update({ data, ...columnsPatch(columns) })
        .eq("id", id)
        .eq("status", "draft") // guard: never mutate a non-draft
        .select("id")
        .maybeSingle();
      return Boolean(row);
    },

    async claimSubmit(id, data, columns, submittedAt) {
      // Atomic conditional claim — only the request that flips draft→submitted
      // gets a row back; a concurrent submit sees zero rows (already claimed).
      const { data: row } = await admin
        .from(TABLE)
        .update({ status: "submitted", submitted_at: submittedAt, data, ...columnsPatch(columns) })
        .eq("id", id)
        .eq("status", "draft")
        .select("id")
        .maybeSingle();
      return Boolean(row);
    },
  };
}
