"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  ClientStatus,
  ServiceType,
  StageStatus,
} from "@/lib/database.types";

export interface ActionResult {
  ok?: boolean;
  error?: string;
  clientId?: string;
}

const DEFAULT_STAGES = [
  "Contract Signed",
  "Onboarding Submitted",
  "Assets Received",
  "In Development",
  "Review Stage",
  "Launch",
];

/**
 * Create a new client (tenant): the client row, its purchased services, a
 * default project roadmap, and a login for the client contact.
 */
export async function createClientAction(formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const contactName = String(formData.get("contact_name") ?? "").trim();
  const email = String(formData.get("contact_email") ?? "").trim();
  const phone = String(formData.get("contact_phone") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const services = formData.getAll("services").map(String) as ServiceType[];

  if (!name || !email) {
    return { error: "Client name and contact email are required." };
  }
  if (password && password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const supabase = await createClient();

  // 1. Create the tenant.
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .insert({
      name,
      contact_name: contactName || null,
      contact_email: email,
      contact_phone: phone || null,
      status: "onboarding",
    })
    .select("id")
    .single();

  if (clientErr || !client) {
    return { error: clientErr?.message ?? "Could not create client." };
  }

  // 2. Attach purchased services.
  if (services.length > 0) {
    await supabase.from("client_services").insert(
      services.map((service) => ({
        client_id: client.id,
        service,
        onboarding_status: "not_started" as const,
      }))
    );
  }

  // 3. Seed a default project roadmap.
  await supabase.from("project_stages").insert(
    DEFAULT_STAGES.map((name, i) => ({
      client_id: client.id,
      name,
      status: (i === 0 ? "in_progress" : "pending") as StageStatus,
      position: i + 1,
    }))
  );

  // 4. Create the client's login (service role). The DB trigger creates the
  //    matching profile from the user metadata.
  if (password) {
    try {
      const admin = createAdminClient();
      const { error: authErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: contactName || name,
          role: "client",
          client_id: client.id,
        },
      });
      if (authErr) {
        return {
          ok: true,
          clientId: client.id,
          error: `Client created, but login could not be provisioned: ${authErr.message}`,
        };
      }
    } catch (e) {
      return {
        ok: true,
        clientId: client.id,
        error:
          "Client created. Configure SUPABASE_SERVICE_ROLE_KEY to auto-provision logins.",
      };
    }
  }

  revalidatePath("/admin/clients");
  revalidatePath("/admin");
  return { ok: true, clientId: client.id };
}

export async function updateClientStatusAction(
  clientId: string,
  status: ClientStatus
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("clients")
    .update({ status })
    .eq("id", clientId);
  if (error) return { error: error.message };
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/admin/clients");
  return { ok: true };
}

export async function postUpdateAction(formData: FormData): Promise<ActionResult> {
  const profile = await requireAdmin();
  const clientId = String(formData.get("client_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!clientId || !title || !body) return { error: "All fields are required." };

  const supabase = await createClient();
  const { error } = await supabase.from("updates").insert({
    client_id: clientId,
    title,
    body,
    author_id: profile.id,
    author_name: profile.full_name ?? "Bbettr Agency",
  });
  if (error) return { error: error.message };
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/admin/updates");
  return { ok: true };
}

export async function upsertReportAction(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const clientId = String(formData.get("client_id") ?? "");
  const month = String(formData.get("reporting_month") ?? "");
  if (!clientId || !month) return { error: "Client and month are required." };

  const num = (k: string) => {
    const v = formData.get(k);
    if (v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const text = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v || null;
  };

  const supabase = await createClient();
  const { error } = await supabase.from("reports").upsert(
    {
      client_id: clientId,
      reporting_month: month,
      ad_spend: num("ad_spend"),
      leads_generated: num("leads_generated"),
      cost_per_lead: num("cost_per_lead"),
      clicks: num("clicks"),
      impressions: num("impressions"),
      conversion_rate: num("conversion_rate"),
      summary: text("summary"),
      key_wins: text("key_wins"),
      opportunities: text("opportunities"),
      next_month_plan: text("next_month_plan"),
    },
    { onConflict: "client_id,reporting_month" }
  );
  if (error) return { error: error.message };
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/admin/reports");
  return { ok: true };
}

export async function setStageStatusAction(
  stageId: string,
  clientId: string,
  status: StageStatus
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_stages")
    .update({ status })
    .eq("id", stageId);
  if (error) return { error: error.message };
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

export async function addStageAction(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const clientId = String(formData.get("client_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!clientId || !name) return { error: "Stage name is required." };

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("project_stages")
    .select("position")
    .eq("client_id", clientId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("project_stages").insert({
    client_id: clientId,
    name,
    position: (last?.position ?? 0) + 1,
    status: "pending",
  });
  if (error) return { error: error.message };
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}
