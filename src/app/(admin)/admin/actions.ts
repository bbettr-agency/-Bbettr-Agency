"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidateClient } from "@/lib/revalidate";
import { getEmailService, type EmailKind } from "@/lib/email";
import type {
  ClientStatus,
  ServiceType,
  StageStatus,
} from "@/lib/database.types";

export interface ActionResult {
  ok?: boolean;
  error?: string;
  clientId?: string;
  /** A freshly generated temporary password, returned once for the admin to copy. */
  password?: string;
}

/** Generate a strong, human-shareable temporary password (no ambiguous chars). */
function generateTempPassword(length = 14): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#$%";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
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

/**
 * Translate raw email-provider errors into clear admin-facing guidance.
 * Supabase's shared email sender has a very low hourly cap.
 */
function friendlyEmailError(raw?: string): string {
  const msg = (raw ?? "").toLowerCase();
  if (msg.includes("rate limit") || msg.includes("rate_limit") || msg.includes("429")) {
    return "Supabase email limit reached. Configure SMTP or Resend for production. In the meantime, use “Copy login instructions” to share access manually.";
  }
  return raw ?? "Could not send the email. Please try again.";
}

/**
 * Send a portal email to a client (welcome / resend credentials / password
 * reset). Routed through the swappable email service (Supabase in V1).
 */
export async function sendPortalEmailAction(
  clientId: string,
  kind: EmailKind
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("contact_email")
    .eq("id", clientId)
    .single();

  const email = client?.contact_email;
  if (!email) return { error: "This client has no email address on file." };

  const result = await getEmailService().send(kind, email);
  if (!result.ok) {
    return { error: friendlyEmailError(result.error) };
  }
  return { ok: true };
}

/**
 * Reset a client's portal password to a freshly generated temporary one and
 * return it ONCE so the admin can copy & share it securely. The plaintext is
 * never stored (Supabase keeps only the hash) — this is the only way the admin
 * can obtain a shareable password, since a self-serve reset email is chosen by
 * the client and can't be surfaced here.
 */
export async function resetTempPasswordAction(
  clientId: string
): Promise<ActionResult> {
  await requireAdmin();

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      error:
        "Server is missing its service-role key, so the password could not be reset.",
    };
  }

  const supabase = await createClient();
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id")
    .eq("client_id", clientId)
    .limit(1);

  const userId = profiles?.[0]?.id;
  if (!userId) return { error: "This client has no portal login yet." };

  const password = generateTempPassword();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return { error: error.message };

  return { ok: true, password };
}

export async function updateClientStatusAction(
  clientId: string,
  status: ClientStatus
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();

  // Soft guard: an account can't be "Completed" until the project has launched.
  // Prevents showing "Completed" while the roadmap is still in progress.
  if (status === "completed") {
    const { data: launch } = await supabase
      .from("project_stages")
      .select("status")
      .eq("client_id", clientId)
      .eq("name", "Launch")
      .maybeSingle();
    if (!launch || launch.status !== "completed") {
      return {
        error:
          "You can't set Account Status to Completed until the Launch stage is complete.",
      };
    }
  }

  const { error } = await supabase
    .from("clients")
    .update({ status })
    .eq("id", clientId);
  if (error) return { error: error.message };
  revalidateClient(clientId);
  return { ok: true };
}

/**
 * Admin-approves a client's assets: completes the "Assets Received" stage,
 * starts "In Development", ensures the client is in active delivery, and
 * (optionally) posts a client update. The admin remains the decision-maker —
 * this is a deliberate approval, not automatic.
 */
export async function markAssetsReceivedAction(
  clientId: string,
  postUpdate: boolean
): Promise<ActionResult> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const { error: completeError } = await supabase
    .from("project_stages")
    .update({ status: "completed" })
    .eq("client_id", clientId)
    .eq("name", "Assets Received");
  if (completeError) return { error: completeError.message };

  // Start "In Development" if it hasn't begun yet.
  await supabase
    .from("project_stages")
    .update({ status: "in_progress" })
    .eq("client_id", clientId)
    .eq("name", "In Development")
    .eq("status", "pending");

  // Ensure the client is in active delivery (no-op if already further along).
  await supabase
    .from("clients")
    .update({ status: "in_progress" })
    .eq("id", clientId)
    .eq("status", "onboarding");

  if (postUpdate) {
    await supabase.from("updates").insert({
      client_id: clientId,
      title: "Assets Received — Development Started",
      body: "We've received everything we need and your project has moved into development. We'll keep you posted as we make progress.",
      author_id: profile.id,
      author_name: profile.full_name ?? "Bbettr Agency",
    });
  }

  revalidateClient(clientId);
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
  revalidateClient(clientId);
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
  revalidateClient(clientId);
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
  revalidateClient(clientId);
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
  revalidateClient(clientId);
  return { ok: true };
}

const STORAGE_BUCKET = "client-files";

/**
 * Permanently delete a client (tenant) and EVERYTHING associated with it.
 *
 * The database does most of the work via ON DELETE CASCADE from clients(id):
 * deleting the client row removes client_services, onboarding_submissions,
 * project_stages, updates, reports and files rows automatically.
 *
 * Two things are NOT covered by the cascade and are handled explicitly here:
 *   1. Supabase Storage objects under client-files/<clientId>/.
 *   2. The client's auth login(s) — profiles.client_id is ON DELETE SET NULL,
 *      so we delete the auth users, which cascades their profile rows away.
 *
 * Requires admin. `confirmationName` must match the client's name exactly
 * (defence-in-depth on top of the UI's type-to-confirm).
 */
export async function deleteClientAction(
  clientId: string,
  confirmationName: string
): Promise<ActionResult> {
  await requireAdmin();

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      error:
        "Server is missing its service-role key, so the client could not be deleted.",
    };
  }

  // 1. Verify the client exists and the typed name matches exactly.
  const { data: client } = await admin
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .single();
  if (!client) return { error: "Client not found." };
  if (confirmationName.trim() !== client.name) {
    return { error: "The name you typed does not match this client." };
  }

  // 2. Gather everything that won't be removed by the DB cascade — BEFORE we
  //    delete the client row (afterwards files rows are gone and profiles are
  //    unlinked, so they'd be unfindable).
  const [{ data: fileRows }, { data: profileRows }, { data: storageList }] =
    await Promise.all([
      admin.from("files").select("path").eq("client_id", clientId),
      admin.from("profiles").select("id").eq("client_id", clientId),
      admin.storage.from(STORAGE_BUCKET).list(clientId, { limit: 1000 }),
    ]);

  // 3. Remove storage objects (from the files table + a folder listing as a
  //    safety net), de-duplicated.
  const paths = new Set<string>();
  (fileRows ?? []).forEach((f) => f.path && paths.add(f.path));
  (storageList ?? []).forEach((o) => paths.add(`${clientId}/${o.name}`));
  if (paths.size > 0) {
    await admin.storage.from(STORAGE_BUCKET).remove(Array.from(paths));
  }

  // 4. Delete the client's auth logins (cascades their profile rows).
  for (const p of profileRows ?? []) {
    try {
      await admin.auth.admin.deleteUser(p.id);
    } catch {
      // Continue — a missing/already-deleted auth user must not block cleanup.
    }
  }

  // 5. Delete the client row — cascades all remaining tenant child tables.
  const { error: deleteError } = await admin
    .from("clients")
    .delete()
    .eq("id", clientId);
  if (deleteError) return { error: deleteError.message };

  // 6. Refresh every admin surface so counts/lists update immediately.
  revalidatePath("/admin");
  revalidatePath("/admin/clients");
  revalidatePath("/admin/reports");
  revalidatePath("/admin/updates");
  revalidatePath("/admin/files");

  return { ok: true };
}
