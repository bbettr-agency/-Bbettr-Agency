import "server-only";
import { createClient } from "@/lib/supabase/server";
import { toBillingView, type BillingDetailsView } from "@/lib/billing-details";

const COLUMNS =
  "client_id, invoice_name, company_registration_number, vat_number, billing_email, billing_email_same_as_contact, billing_contact_name, billing_address, po_reference, invoice_instructions, updated_by, created_at, updated_at";

/**
 * Read a client's billing profile through the SESSION (RLS) client — admins see
 * any client's row; a client sees only their own. Returns a whitelisted view (or
 * null). No service-role client. Fetch this ONLY on billing surfaces (onboarding
 * billing section, admin client Billing Details) — never in general payloads.
 */
export async function getBillingDetails(clientId: string): Promise<BillingDetailsView | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("client_billing_details")
    .select(COLUMNS)
    .eq("client_id", clientId)
    .maybeSingle();
  return toBillingView(data ?? null);
}
