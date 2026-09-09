import "server-only";
import { createClient } from "@/lib/supabase/server";
import { canDismiss } from "./intake-lifecycle";

/**
 * Admin read/triage access to prospect intakes (P3-A).
 *
 * All access goes through the AUTHENTICATED admin Supabase client (`createClient`),
 * so the `0058` RLS policy ("Admins manage prospect intakes"; anon denied; no
 * client policy) is the enforced boundary — NO service-role is used for admin
 * reads/writes here, and RLS is unchanged. Pages/actions additionally call
 * `requireAdmin()`. Drafts are never surfaced as actionable leads.
 */

export type AdminIntakeStatus = "submitted" | "dismissed";

export interface AdminIntakeListRow {
  id: string;
  business_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  selected_services: string[];
  source: "generic" | "personalised";
  status: string;
  submitted_at: string | null;
  updated_at: string;
}

export interface AdminIntakeRow extends AdminIntakeListRow {
  data: Record<string, unknown>;
  created_at: string;
  converted_at: string | null;
}

const LIST_COLUMNS =
  "id, business_name, contact_name, email, phone, selected_services, source, status, submitted_at, updated_at";

/**
 * List intakes for the triage inbox. Only `submitted` (actionable) or
 * `dismissed` (read-only history) are ever listed — drafts and converted are
 * never returned. Submitted sorts by submission time; dismissed by last change.
 */
export async function listProspectIntakes(status: AdminIntakeStatus): Promise<AdminIntakeListRow[]> {
  const supabase = await createClient();
  const orderCol = status === "submitted" ? "submitted_at" : "updated_at";
  const { data, error } = await supabase
    .from("prospect_intakes")
    .select(LIST_COLUMNS)
    .eq("status", status)
    .order(orderCol, { ascending: false, nullsFirst: false });
  if (error) throw new Error("intake_list_failed");
  return (data ?? []) as AdminIntakeListRow[];
}

/** Full row for the detail page (admin RLS enforced). Null when not found. */
export async function getProspectIntake(id: string): Promise<AdminIntakeRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("prospect_intakes")
    .select(`${LIST_COLUMNS}, data, created_at, converted_at`)
    .eq("id", id)
    .maybeSingle();
  return (data as AdminIntakeRow | null) ?? null;
}

/**
 * Dismiss a SUBMITTED intake (submitted → dismissed). Guarded at the mutation
 * boundary (`WHERE id=? AND status='submitted'`) so it can never touch a
 * converted/dismissed/draft row, and it NEVER deletes — the row + `data` are
 * preserved. Returns true only if a submitted row was transitioned. Callers must
 * have already enforced `requireAdmin()`; RLS enforces admin regardless.
 */
export async function dismissSubmittedIntake(id: string): Promise<boolean> {
  // Domain guard mirrors the lifecycle (delegates to canTransition).
  if (!canDismiss("submitted")) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from("prospect_intakes")
    .update({ status: "dismissed" })
    .eq("id", id)
    .eq("status", "submitted")
    .select("id")
    .maybeSingle();
  return Boolean(data);
}
