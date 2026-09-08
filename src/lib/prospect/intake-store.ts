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
      // updated_at is the optimistic-concurrency version — selected verbatim and
      // carried, unmodified, into the submit CAS below.
      const { data } = await admin
        .from(TABLE)
        .select("id, status, source, token_expires_at, updated_at, data")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      return (data as StoredIntake | null) ?? null;
    },

    async updateDraftData(id, data, columns) {
      // Atomic draft-only guard AT the mutation boundary: a save can never write
      // a row that has already left `draft` (e.g. a submit that won the claim).
      const { data: row } = await admin
        .from(TABLE)
        .update({ data, ...columnsPatch(columns) })
        .eq("id", id)
        .eq("status", "draft")
        .select("id")
        .maybeSingle();
      return Boolean(row);
    },

    async claimSubmit(id, expectedUpdatedAt, submittedAt) {
      // Compare-and-swap: transition draft→submitted ONLY if this exact version
      // is still current. Writes nothing but status + submitted_at, so no data
      // snapshot can ever be carried back into the row. A save that landed after
      // the read bumped updated_at (trigger), so the guard matches zero rows and
      // the caller re-reads/re-validates. Only the winning request gets a row.
      const { data: row } = await admin
        .from(TABLE)
        .update({ status: "submitted", submitted_at: submittedAt })
        .eq("id", id)
        .eq("status", "draft")
        .eq("updated_at", expectedUpdatedAt)
        .select("id")
        .maybeSingle();
      return Boolean(row);
    },
  };
}
