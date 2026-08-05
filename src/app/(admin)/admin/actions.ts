"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidateClient } from "@/lib/revalidate";
import { getEmailService, type EmailKind } from "@/lib/email";
import {
  sendClientWelcomeEmail,
  sendInvoiceAvailableEmail,
  sendInvoiceReminderEmail,
} from "@/lib/email/client-notifications";
import { notify } from "@/lib/notifications";
import { notifyInternal, notifyAdmins } from "@/lib/internal-notifications";
import {
  sendInvoiceApprovedEmail,
  sendInvoiceRejectedEmail,
} from "@/lib/email/rep-notifications";
import { createInvoiceForRequest } from "@/lib/quickbooks";
import { createPaymentForRequest, isPayfastConfigured } from "@/lib/payfast";
import { logActivity } from "@/lib/activity";
import { SERVICE_LIST, getService } from "@/lib/services";
import { advanceIntakeStatus } from "@/lib/intake-advance";
import { STAGE_TO_JOURNEY } from "@/lib/journey";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import type {
  Database,
  ClientStatus,
  ServiceType,
  StageStatus,
  IntakeStatus,
  InvoiceStatus,
  InvoiceKind,
  PaymentMethod,
} from "@/lib/database.types";

type ClientInvoiceUpdate = Database["public"]["Tables"]["client_invoices"]["Update"];
type ClientRetainerUpdate = Database["public"]["Tables"]["client_retainers"]["Update"];

export interface ActionResult {
  ok?: boolean;
  error?: string;
  clientId?: string;
  /** A freshly generated temporary password, returned once for the admin to copy. */
  password?: string;
  /** True when an add-service request was a safe no-op (the service already existed). */
  alreadyAdded?: boolean;
}

/**
 * Name clients see on updates/communications. Always the company, never the
 * individual admin (the internal admin account keeps its real name).
 */
const CLIENT_FACING_AUTHOR = "Bbettr Team";

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
  const onboardingType =
    String(formData.get("onboarding_type") ?? "legacy") === "new"
      ? "new"
      : "legacy";
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
      onboarding_type: onboardingType,
      // Legacy = already operating (past the gate); New = start of intake.
      intake_status: onboardingType === "new" ? "draft" : "onboarding_started",
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

  // 3b. Seed the client-facing activity timeline (best-effort, never blocks).
  await logActivity({
    clientId: client.id,
    type: "project_created",
    title: "Project Created",
    visibility: "client",
  });

  // 4. Create the client's login (service role). The DB trigger creates the
  //    matching profile from the user metadata. New (intake) clients are NOT
  //    provisioned here — access is granted later via Grant Portal Access.
  if (password && onboardingType === "legacy") {
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
      await logActivity({
        clientId: client.id,
        type: "portal_access_granted",
        title: "Portal Access Granted",
        visibility: "client",
      });
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
 * Send a portal email to a client.
 *
 * - welcome / resend_credentials → a branded email containing FULL login
 *   credentials (portal URL, login email, temporary password). Original
 *   passwords can't be retrieved (Supabase stores only the hash), so we mint a
 *   FRESH temporary password, set it on the auth user, then email it — never an
 *   empty or stale one. The password is also returned once for the admin UI.
 * - password_reset → Supabase's self-serve reset email (the client chooses their
 *   own password, so there's nothing for us to surface).
 */
export async function sendPortalEmailAction(
  clientId: string,
  kind: EmailKind
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("contact_email, contact_name, name")
    .eq("id", clientId)
    .single();

  const email = client?.contact_email;
  if (!email) return { error: "This client has no email address on file." };

  // Self-serve reset stays on Supabase's own reset email.
  if (kind === "password_reset") {
    const result = await getEmailService().send(kind, email);
    return result.ok ? { ok: true } : { error: friendlyEmailError(result.error) };
  }

  // welcome | resend_credentials → mint a fresh temp password + email it.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      error:
        "Server is missing its service-role key, so credentials could not be sent.",
    };
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id")
    .eq("client_id", clientId)
    .limit(1);
  const userId = profiles?.[0]?.id;
  if (!userId) {
    return {
      error:
        "This client has no portal login yet. Use “Grant Portal Access” first.",
    };
  }

  const password = generateTempPassword();
  const { error: pwErr } = await admin.auth.admin.updateUserById(userId, {
    password,
  });
  if (pwErr) return { error: pwErr.message };

  const res = await sendClientWelcomeEmail({
    to: email,
    name: client?.contact_name || client?.name || null,
    loginEmail: email,
    password,
  });

  if (!res.ok) {
    // Password was reset but the email failed — hand the password to the admin
    // to share manually rather than leaving them stuck.
    return {
      ok: true,
      password,
      error: `${friendlyEmailError(
        res.error
      )} The temporary password is shown so you can share it manually.`,
    };
  }

  // Record welcome-email sends so the Intake panel can show the status.
  if (kind === "welcome") {
    await supabase
      .from("clients")
      .update({ welcome_email_sent_at: new Date().toISOString() })
      .eq("id", clientId);
    revalidatePath(`/admin/clients/${clientId}`);
  }
  return { ok: true, password };
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

/**
 * Add a single additional service to an EXISTING client's account (additive only).
 *
 * Admin-only. The insert runs as the authenticated admin through the RLS server
 * client (the `client_services` "Admins manage all" policy authorizes it) — no
 * service-role path. It is idempotent: `client_services.unique(client_id, service)`
 * is the final duplicate boundary, and a conflict-safe insert can never overwrite
 * or reset an existing row. It touches ONLY `client_services` — never
 * `onboarding_submissions` or `project_stages`, so completed onboarding and the
 * roadmap are preserved. The client's Portal exposes the new onboarding form
 * automatically (forms are derived from `client_services`).
 */
export async function addClientServiceAction(
  clientId: string,
  service: ServiceType
): Promise<ActionResult> {
  const admin = await requireAdmin();

  // Validate the service against the bounded catalogue (reject free-text/unknown).
  if (!SERVICE_LIST.some((s) => s.id === service)) {
    return { error: "Unsupported service." };
  }

  const supabase = await createClient();

  // Validate the target client exists (server-derived; never trust the browser).
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .single();
  if (clientErr || !client) return { error: "Client not found." };

  // Idempotent: if the row already exists, leave it exactly as-is (no reset).
  const { data: existing } = await supabase
    .from("client_services")
    .select("id")
    .eq("client_id", clientId)
    .eq("service", service)
    .maybeSingle();
  if (existing) return { ok: true, alreadyAdded: true };

  // Insert ONLY the selected service at not_started. On a unique-violation race,
  // treat it as an idempotent no-op rather than an error.
  const { error: insErr } = await supabase
    .from("client_services")
    .insert({ client_id: clientId, service, onboarding_status: "not_started" });
  if (insErr) {
    if (insErr.code === "23505") return { ok: true, alreadyAdded: true };
    return { error: "Could not add the service. Please try again." };
  }

  // Internal admin audit only (best-effort; never blocks). Captures client,
  // service, admin actor + timestamp.
  await logActivity({
    clientId,
    type: "service_added",
    title: `${getService(service).name} added to ${client.name}`,
    description: `Added by ${admin.full_name ?? "an admin"}`,
    visibility: "internal",
    createdBy: admin.id,
    source: "manual",
  });

  revalidateClient(clientId);
  return { ok: true };
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
      // Client-facing attribution shows the company, not the individual admin.
      author_name: CLIENT_FACING_AUTHOR,
    });
  }

  await notify({
    clientId,
    type: "stage_advanced",
    title: "Your project has moved into Development",
    body: "We've received everything we need and your project is now in development. We'll keep you posted as we make progress.",
    link: "/dashboard/project",
    email: { ctaLabel: "View project progress" },
  });

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
    author_name: CLIENT_FACING_AUTHOR,
  });
  if (error) return { error: error.message };

  await notify({
    clientId,
    type: "update_posted",
    title: `New update: ${title}`,
    body,
    link: "/dashboard/updates",
  });

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

  // Detect whether this is a brand-new report so we only email on publish,
  // not on every edit.
  const { data: existing } = await supabase
    .from("reports")
    .select("id")
    .eq("client_id", clientId)
    .eq("reporting_month", month)
    .maybeSingle();

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

  if (!existing) {
    const monthLabel = format(new Date(`${month}T00:00:00`), "MMMM yyyy");
    await notify({
      clientId,
      type: "report_published",
      title: `Your ${monthLabel} report is ready`,
      body: `Your performance report for ${monthLabel} has been published. Open your portal to see your results.`,
      link: "/dashboard/reports",
      email: { ctaLabel: "View your report" },
    });
  }

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

  // Read the prior state + name so we only notify on meaningful forward
  // movement (a stage starting or completing), not on every cycle.
  const { data: before } = await supabase
    .from("project_stages")
    .select("name, status")
    .eq("id", stageId)
    .single();

  const { error } = await supabase
    .from("project_stages")
    .update({ status })
    .eq("id", stageId);
  if (error) return { error: error.message };

  if (before && before.status !== status && status === "in_progress") {
    await notify({
      clientId,
      type: "stage_advanced",
      title: `Your project has moved to: ${before.name}`,
      body: `Your project has progressed to the "${before.name}" stage. Open your portal to see the latest.`,
      link: "/dashboard/project",
      email: { ctaLabel: "View project progress" },
    });
  }

  // Append a client-facing journey event on a forward transition (best-effort).
  // Uses the client-facing journey label, never the internal stage name.
  if (before && before.status !== status) {
    const label = STAGE_TO_JOURNEY[before.name] ?? before.name;
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const isLaunch = label.toLowerCase() === "launch";
    if (status === "in_progress") {
      await logActivity({
        clientId,
        type: isLaunch ? "launch_scheduled" : `${slug}_started`,
        title: isLaunch ? "Launch Scheduled" : `${label} started`,
        visibility: "client",
      });
    } else if (status === "completed") {
      await logActivity({
        clientId,
        type: isLaunch ? "website_launched" : `${slug}_complete`,
        title: isLaunch ? "Website Launched" : `${label} complete`,
        visibility: "client",
      });
    }
  }

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

// ── Client Experience admin controls ──────────────────────────────────────

/** Set (or clear) a client's estimated launch date. */
export async function setClientLaunchDateAction(
  clientId: string,
  date: string | null
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("clients")
    .update({ estimated_launch_date: date || null })
    .eq("id", clientId);
  if (error) return { error: error.message };
  revalidateClient(clientId);
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

/** Assign a Success Manager to a client (empty → fall back to the default). */
export async function assignSuccessManagerAction(
  clientId: string,
  teamMemberId: string | null
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("clients")
    .update({ success_manager_id: teamMemberId || null })
    .eq("id", clientId);
  if (error) return { error: error.message };
  revalidateClient(clientId);
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

/** Set (or clear) the estimated completion date for a single project stage. */
export async function setStageTargetDateAction(
  stageId: string,
  clientId: string,
  date: string | null
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_stages")
    .update({ target_date: date || null })
    .eq("id", stageId);
  if (error) return { error: error.message };
  revalidateClient(clientId);
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

/** Manually add a timeline event for a client. */
export async function addActivityEventAction(
  formData: FormData
): Promise<ActionResult> {
  const profile = await requireAdmin();
  const clientId = String(formData.get("client_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!clientId || !title) return { error: "Event title is required." };

  const type = String(formData.get("type") ?? "").trim() || "milestone";
  const description = String(formData.get("description") ?? "").trim() || null;
  const visibility =
    String(formData.get("visibility") ?? "client") === "internal"
      ? "internal"
      : "client";
  const occurredRaw = String(formData.get("occurred_at") ?? "").trim();

  const supabase = await createClient();
  const { error } = await supabase.from("activity_events").insert({
    client_id: clientId,
    type,
    title,
    description,
    visibility,
    occurred_at: occurredRaw ? new Date(occurredRaw).toISOString() : undefined,
    source: "manual",
    created_by: profile.id,
  });
  if (error) return { error: error.message };
  revalidateClient(clientId);
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

/** Delete a timeline event. */
export async function deleteActivityEventAction(
  eventId: string,
  clientId: string
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("activity_events")
    .delete()
    .eq("id", eventId);
  if (error) return { error: error.message };
  revalidateClient(clientId);
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

/**
 * Advance a NEW client's intake status when a contract is sent/signed. Delegates
 * to the shared, service-role helper (guarded to new clients + forward-only).
 */

// ── Contracts (Phase B) ───────────────────────────────────────────────────

/** Create a contract record for a client. */
export async function addContractAction(
  formData: FormData
): Promise<ActionResult> {
  const profile = await requireAdmin();
  const clientId = String(formData.get("client_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!clientId || !title) return { error: "Contract title is required." };
  const contractUrl = String(formData.get("contract_url") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("contracts").insert({
    client_id: clientId,
    title,
    contract_url: contractUrl,
    status: "not_sent",
    created_by: profile.id,
  });
  if (error) return { error: error.message };
  revalidateClient(clientId);
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

/** Mark a contract as sent for signature. */
export async function markContractSentAction(
  contractId: string,
  clientId: string
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("contracts")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", contractId);
  if (error) return { error: error.message };

  await logActivity({
    clientId,
    type: "contract_sent",
    title: "Agreement sent for signature",
    visibility: "client",
  });
  // Advance the intake pipeline for new clients (never moves legacy clients).
  await advanceIntakeStatus(clientId, "contract_sent", ["draft"]);
  revalidateClient(clientId);
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

/**
 * Mark a contract as signed. Records the timestamp and a client-visible activity
 * event. Phase B only — this does NOT advance intake or auto-invoice.
 */
export async function markContractSignedAction(
  contractId: string,
  clientId: string
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("contracts")
    .update({ status: "signed", signed_at: new Date().toISOString() })
    .eq("id", contractId);
  if (error) return { error: error.message };

  await logActivity({
    clientId,
    type: "contract_signed",
    title: "Contract signed",
    visibility: "client",
  });
  await advanceIntakeStatus(clientId, "contract_signed", [
    "draft",
    "contract_sent",
  ]);
  revalidateClient(clientId);
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

/** Link an uploaded signed file (Files → contracts category) to a contract. */
export async function attachContractFileAction(
  contractId: string,
  clientId: string,
  fileId: string
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("contracts")
    .update({ file_id: fileId })
    .eq("id", contractId);
  if (error) return { error: error.message };
  revalidateClient(clientId);
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

/** Delete a contract record (does not delete any linked file). */
export async function deleteContractAction(
  contractId: string,
  clientId: string
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("contracts").delete().eq("id", contractId);
  if (error) return { error: error.message };
  revalidateClient(clientId);
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

// ── Client Intake (Phase C) ───────────────────────────────────────────────

/** Manually set a client's intake status (admin command-center advance). */
export async function setIntakeStatusAction(
  clientId: string,
  status: IntakeStatus
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("clients")
    .update({ intake_status: status })
    .eq("id", clientId);
  if (error) return { error: error.message };
  revalidateClient(clientId);
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

/**
 * Grant portal access to a client: provision the Supabase login with a fresh
 * temporary password, send the welcome email, record who/when, advance intake to
 * 'portal_access_sent', and log the activity. Returns the temp password once for
 * the admin to copy. Idempotent guard: refuses if a login already exists (use
 * Resend credentials instead).
 */
export async function provisionPortalAccessAction(
  clientId: string
): Promise<ActionResult> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("name, contact_name, contact_email")
    .eq("id", clientId)
    .single();
  if (!client?.contact_email) {
    return { error: "This client has no contact email to provision a login." };
  }

  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("client_id", clientId)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return {
      error:
        "This client already has portal access. Use “Resend credentials” to re-send the welcome email.",
    };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      error: "Server is missing its service-role key, so access could not be provisioned.",
    };
  }

  const password = generateTempPassword();
  const { error: authErr } = await admin.auth.admin.createUser({
    email: client.contact_email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: client.contact_name || client.name,
      role: "client",
      client_id: clientId,
    },
  });
  if (authErr) return { error: `Could not provision access: ${authErr.message}` };

  // Welcome email with full login credentials (best-effort) — failure is
  // non-fatal; the same temp password is returned so the admin can share access
  // manually. The password is never stored, only emailed once + shown once.
  let emailWarning: string | undefined;
  try {
    const res = await sendClientWelcomeEmail({
      to: client.contact_email,
      name: client.contact_name || client.name,
      loginEmail: client.contact_email,
      password,
    });
    if (!res.ok) emailWarning = friendlyEmailError(res.error);
  } catch (e) {
    emailWarning = e instanceof Error ? e.message : "Welcome email failed to send.";
  }

  const now = new Date().toISOString();
  await supabase
    .from("clients")
    .update({
      intake_status: "portal_access_sent",
      portal_access_granted_at: now,
      portal_access_granted_by: profile.id,
      welcome_email_sent_at: emailWarning ? null : now,
    })
    .eq("id", clientId);

  await logActivity({
    clientId,
    type: "portal_access_granted",
    title: "Portal Access Granted",
    visibility: "client",
  });
  if (!emailWarning) {
    await logActivity({
      clientId,
      type: "welcome_email_sent",
      title: "Welcome email sent",
      visibility: "client",
    });
  }

  // D1: portal access immediately opens onboarding for new clients.
  await advanceIntakeStatus(clientId, "onboarding_started", ["portal_access_sent"], {
    type: "onboarding_started",
    title: "Onboarding opened",
  });

  revalidateClient(clientId);
  revalidatePath(`/admin/clients/${clientId}`);
  return {
    ok: true,
    password,
    error: emailWarning
      ? `Access granted, but the welcome email could not be sent: ${emailWarning}. Share the temporary password manually.`
      : undefined,
  };
}

// ── Deal ↔ Client linkage (Phase D2) ───────────────────────────────────────

/**
 * Manually link an existing (rep-created) deal to a client. No auto-matching —
 * the admin explicitly chooses the deal. Enforces one deal per client at the app
 * layer with a clear message; the DB partial-unique index is the final guard.
 *
 * Catch-up sync: if the deal has already been invoiced or paid (so the DB
 * observers fired before the link existed), advance the client's intake_status
 * to match — forward-only and new-clients-only via advanceIntakeStatus. Audit
 * events are internal-only.
 */
export async function linkDealToClientAction(
  clientId: string,
  dealId: string
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();

  // Reject if this client is already linked to a different deal.
  const { data: existing } = await supabase
    .from("deals")
    .select("id")
    .eq("client_id", clientId)
    .maybeSingle();
  if (existing && existing.id !== dealId) {
    return {
      error:
        "This client is already linked to a deal. Unlink it first to link a different one.",
    };
  }

  // The chosen deal must exist and be unlinked (or already this client's).
  const { data: deal } = await supabase
    .from("deals")
    .select("id, client_id")
    .eq("id", dealId)
    .maybeSingle();
  if (!deal) return { error: "That deal could not be found." };
  if (deal.client_id && deal.client_id !== clientId) {
    return { error: "That deal is already linked to another client." };
  }

  const { error } = await supabase
    .from("deals")
    .update({ client_id: clientId })
    .eq("id", dealId);
  if (error) return { error: error.message };

  // Catch-up: reflect an already invoiced/paid deal in the intake pipeline.
  const { data: req } = await supabase
    .from("invoice_requests")
    .select("id, status")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (req) {
    const { data: pay } = await supabase
      .from("payfast_payments")
      .select("status")
      .eq("invoice_request_id", req.id)
      .maybeSingle();

    if (pay?.status === "paid") {
      await advanceIntakeStatus(
        clientId,
        "paid",
        ["draft", "contract_sent", "contract_signed", "invoice_sent"],
        { type: "invoice_paid", title: "Payment received", visibility: "internal" }
      );
    } else if (req.status === "invoiced") {
      await advanceIntakeStatus(
        clientId,
        "invoice_sent",
        ["draft", "contract_sent", "contract_signed"],
        { type: "invoice_sent", title: "Invoice sent", visibility: "internal" }
      );
    }
  }

  revalidateClient(clientId);
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

/** Unlink any deal currently linked to this client. */
export async function unlinkDealAction(clientId: string): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("deals")
    .update({ client_id: null })
    .eq("client_id", clientId);
  if (error) return { error: error.message };

  revalidateClient(clientId);
  revalidatePath(`/admin/clients/${clientId}`);
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

/** Action-required categories the admin can request from a client. */
export type ActionCategory =
  | "file_approval"
  | "feedback"
  | "information"
  | "blocking";

const ACTION_LABELS: Record<ActionCategory, string> = {
  file_approval: "Approval needed",
  feedback: "Feedback requested",
  information: "Information needed",
  blocking: "Blocking your project",
};

/**
 * Ask the client to take an action (file approval / feedback / info / blocking
 * task). Creates an action_required notification + email and surfaces it
 * prominently on the client dashboard.
 */
export async function requestClientActionAction(
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  const clientId = String(formData.get("client_id") ?? "");
  const category = String(formData.get("category") ?? "") as ActionCategory;
  const title = String(formData.get("title") ?? "").trim();
  const details = String(formData.get("details") ?? "").trim();
  if (!clientId || !title || !ACTION_LABELS[category]) {
    return { error: "A category and title are required." };
  }

  await notify({
    clientId,
    type: "action_required",
    title: `${ACTION_LABELS[category]}: ${title}`,
    body: details || title,
    link: "/dashboard",
    actionRequired: true,
    email: { ctaLabel: "Take action in your portal" },
  });

  revalidateClient(clientId);
  return { ok: true };
}

/** Send the client a reminder that we're still waiting on assets/access. */
export async function sendAssetsReminderAction(
  clientId: string
): Promise<ActionResult> {
  await requireAdmin();
  await notify({
    clientId,
    type: "assets_needed",
    title: "A quick reminder — we still need a few things from you",
    body: "To start your project we still need some assets or access from you. Your portal shows exactly what's outstanding.",
    link: "/dashboard",
    actionRequired: true,
    email: { ctaLabel: "See what's needed" },
  });
  revalidateClient(clientId);
  return { ok: true };
}

/** Mark an action-required notification as resolved (admin, once handled). */
export async function resolveNotificationAction(
  notificationId: string,
  clientId: string
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", notificationId);
  if (error) return { error: error.message };
  revalidateClient(clientId);
  return { ok: true };
}

/**
 * Approve an invoice request (admin): mark it approved, record the rep's
 * commission, notify + email the rep, then create the QuickBooks invoice.
 *
 * Approval/commission/notifications are unchanged from V1; the QuickBooks invoice
 * is a decoupled, best-effort, retryable step appended at the end — a QBO failure
 * never reverses approval or commission.
 */
export async function approveInvoiceRequestAction(
  requestId: string
): Promise<ActionResult> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const { data: req } = await supabase
    .from("invoice_requests")
    .select("id, deal_id, rep_id, amount, status")
    .eq("id", requestId)
    .single();
  if (!req) return { error: "Invoice request not found." };
  if (req.status !== "pending") {
    return { error: "This request has already been actioned." };
  }

  const { error } = await supabase
    .from("invoice_requests")
    .update({ status: "approved", approved_by: profile.id })
    .eq("id", requestId);
  if (error) return { error: error.message };

  // Record-only commission (payout handled later). Rate from the rep's profile.
  const { data: rep } = await supabase
    .from("reps")
    .select("commission_rate")
    .eq("id", req.rep_id)
    .maybeSingle();
  const rate = Number(rep?.commission_rate ?? 0);
  const commissionAmount = Number(req.amount) * (rate / 100);
  const { error: commissionError } = await supabase.from("commissions").insert({
    rep_id: req.rep_id,
    deal_id: req.deal_id,
    amount: commissionAmount,
    rate,
    status: "pending",
  });
  // The request is already approved; surface (don't swallow) a commission
  // failure so the admin knows to follow up rather than assuming it recorded.
  if (commissionError) {
    revalidatePath("/admin/invoices");
    return {
      ok: true,
      error: `Approved, but the commission could not be recorded: ${commissionError.message}`,
    };
  }

  // Notify the rep: invoice approved + commission recorded (in-app bell).
  await notifyInternal({
    recipientId: req.rep_id,
    type: "invoice_approved",
    title: "Invoice approved",
    body: "Your deal was approved and the invoice is being processed.",
    link: "/rep/deals",
  });
  await notifyInternal({
    recipientId: req.rep_id,
    type: "commission_recorded",
    title: `Commission recorded — ${formatCurrency(commissionAmount)}`,
    link: "/rep/earnings",
  });

  // Email the rep that their request was approved (best-effort).
  const [{ data: deal }, { data: repProfile }] = await Promise.all([
    supabase
      .from("deals")
      .select("business_name, package, client_location")
      .eq("id", req.deal_id)
      .maybeSingle(),
    supabase.from("profiles").select("email").eq("id", req.rep_id).maybeSingle(),
  ]);
  if (repProfile?.email && deal) {
    await sendInvoiceApprovedEmail({
      to: repProfile.email,
      businessName: deal.business_name,
      packageName: deal.package,
      amount: Number(req.amount),
      commission: commissionAmount,
    });
  }

  // QuickBooks invoicing — decoupled, best-effort and idempotent. Runs for every
  // approved deal (SA + international; currency is the QBO company's home ZAR).
  // A QuickBooks failure (or QBO not connected) never reverses the approval or
  // the commission: the request stays "approved" with the error recorded and the
  // admin can retry. On success it becomes "invoiced" with the QBO number.
  const invoiceResult = await createInvoiceForRequest(requestId);
  if (invoiceResult.ok) {
    await notifyInternal({
      recipientId: req.rep_id,
      type: "invoice_approved",
      title: invoiceResult.invoiceNumber
        ? `Invoice #${invoiceResult.invoiceNumber} created`
        : "Invoice created in QuickBooks",
      body: "Your deal has been invoiced in QuickBooks.",
      link: "/rep/deals",
    });
  } else {
    await notifyAdmins({
      type: "invoice_request",
      title: "QuickBooks invoice not created",
      body: `Approval succeeded but invoicing failed: ${invoiceResult.error}. You can retry from Invoice Requests.`,
      link: "/admin/invoices",
    });
  }

  // PayFast payment link — INTERNATIONAL clients only, and only once the QBO
  // invoice exists. Decoupled/best-effort/idempotent: South African deals never
  // get a link (they pay by EFT), and a PayFast failure never affects approval,
  // commission or QuickBooks. (No external call — it builds a signed link + row.)
  if (deal?.client_location === "international" && invoiceResult.ok) {
    const payfast = await createPaymentForRequest(requestId);
    if (payfast.ok) {
      await notifyInternal({
        recipientId: req.rep_id,
        type: "invoice_approved",
        title: "Payment link ready",
        body: "A PayFast payment link was created for this international client.",
        link: "/rep/deals",
      });
    } else if (isPayfastConfigured()) {
      await notifyAdmins({
        type: "invoice_request",
        title: "PayFast link not created",
        body: `Invoiced, but the PayFast link failed: ${payfast.error}. You can retry from Invoice Requests.`,
        link: "/admin/invoices",
      });
    }
  }

  revalidatePath("/admin/invoices");
  // Refresh the rep's layout so their notification bell's unread badge updates.
  revalidatePath("/rep", "layout");
  return {
    ok: true,
    error: invoiceResult.ok
      ? undefined
      : `Approved and commission recorded, but the QuickBooks invoice could not be created: ${invoiceResult.error}. You can retry it from this page.`,
  };
}

/**
 * Retry creating the QuickBooks invoice for a request that was approved but
 * whose invoicing failed (or was attempted before QBO was connected). Safe to
 * call repeatedly — idempotent, won't duplicate an existing invoice.
 */
export async function retryInvoiceRequestAction(
  requestId: string
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: req } = await supabase
    .from("invoice_requests")
    .select("id, rep_id, status, quickbooks_invoice_id")
    .eq("id", requestId)
    .single();
  if (!req) return { error: "Invoice request not found." };
  if (req.quickbooks_invoice_id) {
    return { error: "This request has already been invoiced." };
  }
  if (req.status !== "approved") {
    return { error: "Only approved requests can be invoiced." };
  }

  const result = await createInvoiceForRequest(requestId);
  if (!result.ok) return { error: result.error };

  await notifyInternal({
    recipientId: req.rep_id,
    type: "invoice_approved",
    title: result.invoiceNumber
      ? `Invoice #${result.invoiceNumber} created`
      : "Invoice created in QuickBooks",
    body: "Your deal has been invoiced in QuickBooks.",
    link: "/rep/deals",
  });

  revalidatePath("/admin/invoices");
  revalidatePath("/rep", "layout");
  return { ok: true };
}

/**
 * Generate (or reuse) the PayFast payment link for an international invoice
 * request — used to retry a link that failed at approval time. Idempotent: never
 * creates a second link. International-only (the lib enforces this).
 */
export async function generatePayfastLinkAction(
  requestId: string
): Promise<ActionResult> {
  await requireAdmin();
  const result = await createPaymentForRequest(requestId);
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin/invoices");
  revalidatePath("/rep", "layout");
  return { ok: true };
}

/**
 * Manually mark a PayFast payment as paid (V1 — until the ITN webhook lands in
 * V2). Records who confirmed it and when. Does not touch commission or the
 * QuickBooks invoice.
 */
export async function markPayfastPaidAction(
  requestId: string
): Promise<ActionResult> {
  const profile = await requireAdmin();
  const admin = createAdminClient();

  const { data: pay } = await admin
    .from("payfast_payments")
    .select("id, status")
    .eq("invoice_request_id", requestId)
    .maybeSingle();
  if (!pay) return { error: "No PayFast payment found for this request." };
  if (pay.status === "paid") return { error: "This payment is already marked paid." };

  const { error } = await admin
    .from("payfast_payments")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      marked_paid_by: profile.id,
    })
    .eq("invoice_request_id", requestId);
  if (error) return { error: error.message };

  revalidatePath("/admin/invoices");
  revalidatePath("/rep", "layout");
  return { ok: true };
}

/** Reject an invoice request (admin). */
export async function rejectInvoiceRequestAction(
  requestId: string
): Promise<ActionResult> {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const { data: req } = await supabase
    .from("invoice_requests")
    .select("deal_id, rep_id, amount, status")
    .eq("id", requestId)
    .single();
  // Guard like approve: only a pending request can be rejected, so an already
  // approved request (with a recorded commission) can't be flipped to rejected.
  if (!req) return { error: "Invoice request not found." };
  if (req.status !== "pending") {
    return { error: "This request has already been actioned." };
  }

  const { error } = await supabase
    .from("invoice_requests")
    .update({ status: "rejected", approved_by: profile.id })
    .eq("id", requestId);
  if (error) return { error: error.message };

  if (req.rep_id) {
    // In-app bell.
    await notifyInternal({
      recipientId: req.rep_id,
      type: "invoice_rejected",
      title: "Invoice request rejected",
      body: "Please review the deal details or contact the team.",
      link: "/rep/deals",
    });

    // Email the rep that their request was rejected (best-effort).
    const [{ data: deal }, { data: repProfile }] = await Promise.all([
      supabase.from("deals").select("business_name, package").eq("id", req.deal_id).maybeSingle(),
      supabase.from("profiles").select("email").eq("id", req.rep_id).maybeSingle(),
    ]);
    if (repProfile?.email && deal) {
      await sendInvoiceRejectedEmail({
        to: repProfile.email,
        businessName: deal.business_name,
        packageName: deal.package,
        amount: Number(req.amount),
      });
    }
  }

  revalidatePath("/admin/invoices");
  // Refresh the rep's layout so their notification bell's unread badge updates.
  revalidatePath("/rep", "layout");
  return { ok: true };
}

// ── Client Billing (Phase E1) ───────────────────────────────────────────────
// Manual, admin-only billing under the client record. Writes use the admin
// session under the is_admin() RLS policies. No QuickBooks/PayFast write, no
// recurring engine, no commission/intake side effects.

export interface NewInvoiceInput {
  title: string;
  description?: string | null;
  amount: number;
  currency?: string;
  kind?: InvoiceKind;
  /** Initial state: a draft, or sent immediately. Paid is only set via payments. */
  send?: boolean;
  issuedAt?: string | null;
  dueAt?: string | null;
  /** Linked invoice PDF in Files & Assets (asset_category 'invoices'). */
  fileId?: string | null;
}

/** Client-facing label for an invoice status (overdue is derived from due date). */
function invoiceStatusLabel(status: string, dueAt: string | null): string {
  if (status === "paid") return "Paid";
  if (status === "void") return "Cancelled";
  const overdue =
    status === "sent" && dueAt != null && new Date(dueAt).getTime() < Date.now();
  return overdue ? "Overdue" : "Outstanding";
}

/**
 * Best-effort: email the client that an invoice is available + log a
 * client-visible activity event. Called only when an invoice becomes
 * client-visible (created-as-sent or marked sent), never for drafts.
 */
async function notifyInvoiceAvailable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  inv: {
    client_id: string;
    invoice_number: string;
    amount: number;
    currency: string;
    due_at: string | null;
  }
): Promise<void> {
  const { data: client } = await supabase
    .from("clients")
    .select("contact_email, contact_name")
    .eq("id", inv.client_id)
    .maybeSingle();

  if (client?.contact_email) {
    await sendInvoiceAvailableEmail({
      to: client.contact_email,
      clientName: client.contact_name,
      invoiceNumber: inv.invoice_number,
      amount: Number(inv.amount),
      currency: inv.currency,
      dueAt: inv.due_at,
      statusLabel: invoiceStatusLabel("sent", inv.due_at),
    });
  }
  await logActivity({
    clientId: inv.client_id,
    type: "invoice_available",
    title: `Invoice ${inv.invoice_number} available`,
    visibility: "client",
  });
}

/** Create a manual invoice for a client. Reserves the next INV- number. */
export async function createClientInvoiceAction(
  clientId: string,
  input: NewInvoiceInput
): Promise<ActionResult> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const title = input.title?.trim();
  const amount = Number(input.amount);
  if (!title) return { error: "An invoice title is required." };
  if (!Number.isFinite(amount) || amount < 0) {
    return { error: "Enter a valid invoice amount." };
  }

  const { data: numberValue, error: numberError } = await supabase.rpc(
    "next_client_invoice_number"
  );
  if (numberError || !numberValue) {
    return {
      error: `Could not assign an invoice number: ${numberError?.message ?? "no value"}`,
    };
  }

  const currency = input.currency === "USD" ? "USD" : "ZAR";
  const invoiceNumber = numberValue as string;
  const dueAt = input.dueAt ?? null;

  const { error } = await supabase.from("client_invoices").insert({
    client_id: clientId,
    invoice_number: invoiceNumber,
    title,
    description: input.description?.trim() || null,
    amount,
    currency,
    kind: input.kind ?? "one_off",
    status: input.send ? "sent" : "draft",
    issued_at: input.send ? input.issuedAt ?? new Date().toISOString() : input.issuedAt ?? null,
    due_at: dueAt,
    file_id: input.fileId ?? null,
    source: "admin",
    created_by: profile.id,
  });
  if (error) return { error: error.message };

  // Email + activity only when the invoice is client-visible (sent), never draft.
  if (input.send) {
    await notifyInvoiceAvailable(supabase, {
      client_id: clientId,
      invoice_number: invoiceNumber,
      amount,
      currency,
      due_at: dueAt,
    });
  }

  revalidateClient(clientId);
  return { ok: true };
}

export interface UpdateInvoiceInput {
  title?: string;
  description?: string | null;
  amount?: number;
  currency?: string;
  kind?: InvoiceKind;
  issuedAt?: string | null;
  dueAt?: string | null;
  fileId?: string | null;
}

/** Edit a draft/sent invoice. Paid or void invoices are locked. */
export async function updateClientInvoiceAction(
  invoiceId: string,
  input: UpdateInvoiceInput
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: invoice } = await supabase
    .from("client_invoices")
    .select("id, client_id, status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return { error: "Invoice not found." };
  if (invoice.status === "paid" || invoice.status === "void") {
    return { error: "Paid or void invoices can't be edited." };
  }

  const patch: ClientInvoiceUpdate = {};
  if (input.title !== undefined) {
    const t = input.title.trim();
    if (!t) return { error: "An invoice title is required." };
    patch.title = t;
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.amount !== undefined) {
    const a = Number(input.amount);
    if (!Number.isFinite(a) || a < 0) return { error: "Enter a valid invoice amount." };
    patch.amount = a;
  }
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.currency !== undefined) patch.currency = input.currency === "USD" ? "USD" : "ZAR";
  if (input.issuedAt !== undefined) patch.issued_at = input.issuedAt;
  if (input.dueAt !== undefined) patch.due_at = input.dueAt;
  if (input.fileId !== undefined) patch.file_id = input.fileId;

  const { error } = await supabase
    .from("client_invoices")
    .update(patch)
    .eq("id", invoiceId);
  if (error) return { error: error.message };

  revalidateClient(invoice.client_id);
  return { ok: true };
}

/** Move an invoice between draft/sent/void. Paid is driven by payments only. */
export async function setInvoiceStatusAction(
  invoiceId: string,
  status: Extract<InvoiceStatus, "draft" | "sent" | "void">
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: invoice } = await supabase
    .from("client_invoices")
    .select("id, client_id, status, invoice_number, amount, currency, due_at")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return { error: "Invoice not found." };
  if (invoice.status === "paid") {
    return { error: "A paid invoice can't change status. Remove its payments first." };
  }

  const becomingVisible = status === "sent" && invoice.status === "draft";
  const patch: ClientInvoiceUpdate = { status };
  if (becomingVisible) {
    patch.issued_at = new Date().toISOString();
  }
  const { error } = await supabase
    .from("client_invoices")
    .update(patch)
    .eq("id", invoiceId);
  if (error) return { error: error.message };

  // A draft becoming sent is the client's first sight of it → notify.
  if (becomingVisible) {
    await notifyInvoiceAvailable(supabase, {
      client_id: invoice.client_id,
      invoice_number: invoice.invoice_number,
      amount: Number(invoice.amount),
      currency: invoice.currency,
      due_at: invoice.due_at,
    });
  }

  revalidateClient(invoice.client_id);
  return { ok: true };
}

/**
 * Simple, direct "Mark paid" for the client-facing flow: sets status=paid and
 * paid_at without requiring a recorded payment. The richer payment-recording
 * flow (recordPaymentAction) remains available and unchanged. Never touches
 * draft or void invoices.
 */
export async function markInvoicePaidAction(
  invoiceId: string
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: invoice } = await supabase
    .from("client_invoices")
    .select("id, client_id, status, invoice_number, paid_at")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return { error: "Invoice not found." };
  if (invoice.status === "draft") {
    return { error: "Send the invoice before marking it paid." };
  }
  if (invoice.status === "void") {
    return { error: "A cancelled invoice can't be marked paid." };
  }
  if (invoice.status === "paid") return { ok: true };

  const { error } = await supabase
    .from("client_invoices")
    .update({ status: "paid", paid_at: invoice.paid_at ?? new Date().toISOString() })
    .eq("id", invoiceId);
  if (error) return { error: error.message };

  await logActivity({
    clientId: invoice.client_id,
    type: "invoice_paid",
    title: `Invoice ${invoice.invoice_number} marked paid`,
    visibility: "client",
  });
  revalidateClient(invoice.client_id);
  return { ok: true };
}

/**
 * Manually email the client a reminder for an outstanding/overdue invoice.
 * Records `reminded_at` for the admin UI. Best-effort email (never throws).
 */
export async function sendInvoiceReminderAction(
  invoiceId: string
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: invoice } = await supabase
    .from("client_invoices")
    .select("id, client_id, status, invoice_number, amount, currency, due_at")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return { error: "Invoice not found." };
  if (invoice.status !== "sent") {
    return { error: "Reminders are only for outstanding (sent) invoices." };
  }

  const { data: client } = await supabase
    .from("clients")
    .select("contact_email, contact_name")
    .eq("id", invoice.client_id)
    .maybeSingle();
  if (!client?.contact_email) {
    return { error: "This client has no contact email on file." };
  }

  const result = await sendInvoiceReminderEmail({
    to: client.contact_email,
    clientName: client.contact_name,
    invoiceNumber: invoice.invoice_number,
    amount: Number(invoice.amount),
    currency: invoice.currency,
    dueAt: invoice.due_at,
    statusLabel: invoiceStatusLabel(invoice.status, invoice.due_at),
  });
  if (!result.ok) {
    return { error: result.error ?? "Could not send the reminder email." };
  }

  await supabase
    .from("client_invoices")
    .update({ reminded_at: new Date().toISOString() })
    .eq("id", invoiceId);
  revalidateClient(invoice.client_id);
  return { ok: true };
}

/** Delete a draft invoice with no payments. */
export async function deleteClientInvoiceAction(
  invoiceId: string
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: invoice } = await supabase
    .from("client_invoices")
    .select("id, client_id, status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return { error: "Invoice not found." };
  if (invoice.status !== "draft") {
    return { error: "Only draft invoices can be deleted. Void it instead." };
  }
  const { count } = await supabase
    .from("client_payments")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", invoiceId);
  if ((count ?? 0) > 0) {
    return { error: "This invoice has payments and can't be deleted." };
  }

  const { error } = await supabase
    .from("client_invoices")
    .delete()
    .eq("id", invoiceId);
  if (error) return { error: error.message };

  revalidateClient(invoice.client_id);
  return { ok: true };
}

/**
 * Recompute an invoice's paid state from its recorded payments: paid (with
 * paid_at) once payments cover the amount, otherwise reverted to sent. Never
 * touches draft/void invoices.
 */
async function syncInvoicePaidState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invoiceId: string
): Promise<void> {
  const { data: invoice } = await supabase
    .from("client_invoices")
    .select("id, amount, status, paid_at")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice || invoice.status === "draft" || invoice.status === "void") return;

  const { data: pays } = await supabase
    .from("client_payments")
    .select("amount")
    .eq("invoice_id", invoiceId);
  const totalPaid = (pays ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
  const covered = totalPaid >= Number(invoice.amount);

  if (covered && invoice.status !== "paid") {
    await supabase
      .from("client_invoices")
      .update({ status: "paid", paid_at: invoice.paid_at ?? new Date().toISOString() })
      .eq("id", invoiceId);
  } else if (!covered && invoice.status === "paid") {
    await supabase
      .from("client_invoices")
      .update({ status: "sent", paid_at: null })
      .eq("id", invoiceId);
  }
}

export interface NewPaymentInput {
  /** Optional: attach to an invoice (sets it paid once covered). */
  invoiceId?: string | null;
  amount: number;
  method?: PaymentMethod;
  reference?: string | null;
  receivedAt?: string | null;
  notes?: string | null;
}

/** Record a payment received from a client (manual). */
export async function recordPaymentAction(
  clientId: string,
  input: NewPaymentInput
): Promise<ActionResult> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter a valid payment amount." };
  }

  const { error } = await supabase.from("client_payments").insert({
    client_id: clientId,
    invoice_id: input.invoiceId ?? null,
    amount,
    method: input.method ?? "manual",
    reference: input.reference?.trim() || null,
    received_at: input.receivedAt ?? new Date().toISOString(),
    recorded_by: profile.id,
    notes: input.notes?.trim() || null,
  });
  if (error) return { error: error.message };

  if (input.invoiceId) await syncInvoicePaidState(supabase, input.invoiceId);

  revalidateClient(clientId);
  return { ok: true };
}

/** Remove a payment (e.g. entered in error); reverts its invoice if needed. */
export async function deleteClientPaymentAction(
  paymentId: string
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: payment } = await supabase
    .from("client_payments")
    .select("id, client_id, invoice_id")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment) return { error: "Payment not found." };

  const { error } = await supabase
    .from("client_payments")
    .delete()
    .eq("id", paymentId);
  if (error) return { error: error.message };

  if (payment.invoice_id) await syncInvoicePaidState(supabase, payment.invoice_id);

  revalidateClient(payment.client_id);
  return { ok: true };
}

export interface RetainerInput {
  name: string;
  amount: number;
  startedAt?: string | null;
  notes?: string | null;
}

/** Add a record-only retainer to a client. */
export async function addRetainerAction(
  clientId: string,
  input: RetainerInput
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();

  const name = input.name?.trim();
  const amount = Number(input.amount);
  if (!name) return { error: "A retainer name is required." };
  if (!Number.isFinite(amount) || amount < 0) {
    return { error: "Enter a valid retainer amount." };
  }

  const { error } = await supabase.from("client_retainers").insert({
    client_id: clientId,
    name,
    amount,
    started_at: input.startedAt ?? null,
    notes: input.notes?.trim() || null,
  });
  if (error) return { error: error.message };

  revalidateClient(clientId);
  return { ok: true };
}

/** Edit a retainer's details. */
export async function updateRetainerAction(
  retainerId: string,
  input: Partial<RetainerInput>
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: retainer } = await supabase
    .from("client_retainers")
    .select("id, client_id")
    .eq("id", retainerId)
    .maybeSingle();
  if (!retainer) return { error: "Retainer not found." };

  const patch: ClientRetainerUpdate = {};
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) return { error: "A retainer name is required." };
    patch.name = n;
  }
  if (input.amount !== undefined) {
    const a = Number(input.amount);
    if (!Number.isFinite(a) || a < 0) return { error: "Enter a valid retainer amount." };
    patch.amount = a;
  }
  if (input.startedAt !== undefined) patch.started_at = input.startedAt;
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;

  const { error } = await supabase
    .from("client_retainers")
    .update(patch)
    .eq("id", retainerId);
  if (error) return { error: error.message };

  revalidateClient(retainer.client_id);
  return { ok: true };
}

/** Activate/deactivate a retainer (record-only; no billing side effects). */
export async function setRetainerActiveAction(
  retainerId: string,
  active: boolean
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: retainer } = await supabase
    .from("client_retainers")
    .select("id, client_id")
    .eq("id", retainerId)
    .maybeSingle();
  if (!retainer) return { error: "Retainer not found." };

  const { error } = await supabase
    .from("client_retainers")
    .update({ active })
    .eq("id", retainerId);
  if (error) return { error: error.message };

  revalidateClient(retainer.client_id);
  return { ok: true };
}

/** Delete a retainer. */
export async function deleteRetainerAction(
  retainerId: string
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: retainer } = await supabase
    .from("client_retainers")
    .select("id, client_id")
    .eq("id", retainerId)
    .maybeSingle();
  if (!retainer) return { error: "Retainer not found." };

  const { error } = await supabase
    .from("client_retainers")
    .delete()
    .eq("id", retainerId);
  if (error) return { error: error.message };

  revalidateClient(retainer.client_id);
  return { ok: true };
}

// ── Update questions (❓ follow-up requests) ──────────────────────────────────

/** Mark a client's ❓ follow-up request as resolved once the team has actioned it. */
export async function resolveUpdateQuestionAction(
  questionId: string
): Promise<ActionResult> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const { data: question } = await supabase
    .from("update_questions")
    .select("id, client_id, status")
    .eq("id", questionId)
    .maybeSingle();
  if (!question) return { error: "Request not found." };

  if (question.status !== "resolved") {
    const { error } = await supabase
      .from("update_questions")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_by: profile.id,
      })
      .eq("id", questionId);
    if (error) return { error: error.message };
  }

  revalidateClient(question.client_id);
  revalidatePath(`/admin/clients/${question.client_id}`);
  return { ok: true };
}
