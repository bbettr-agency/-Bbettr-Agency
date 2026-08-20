import { createClient } from "@/lib/supabase/server";
import type { NotificationType } from "@/lib/database.types";
import type { ReactionSummary } from "@/lib/update-reactions";

/**
 * Tenant-scoped data access helpers. RLS guarantees a client can only ever
 * read its own rows, but we still filter by client_id explicitly for clarity
 * and so admins can reuse these helpers for a specific tenant.
 */

export interface NotificationFeedItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  action_required: boolean;
  read_at: string | null;
  created_at: string;
}

export interface NotificationFeed {
  items: NotificationFeedItem[];
  unreadCount: number;
}

/**
 * Notification center feed for a client: the latest notifications plus the
 * total unread count. Read-only, under the client's own RLS.
 */
export async function getClientNotificationFeed(
  clientId: string,
  limit = 15
): Promise<NotificationFeed> {
  const supabase = await createClient();

  const [{ data: items }, { count }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, type, title, body, link, action_required, read_at, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .is("read_at", null),
  ]);

  return { items: items ?? [], unreadCount: count ?? 0 };
}

/** Portal sections that carry notification dots, mapped to their nav href. */
export const NOTIFY_SECTIONS = [
  "project",
  "updates",
  "reports",
  "files",
  "invoices",
] as const;
export type NotifySection = (typeof NOTIFY_SECTIONS)[number];

/**
 * The nav item a section's unread dot renders on. The `project` seen-state key
 * is unchanged (still `project` in client_section_views), but Project Progress
 * is no longer a primary nav item (IA Slice 1) — so unseen roadmap/stage
 * activity rolls up to Home, whose Project Journey card surfaces the same
 * content and clears it via the Home <SeenMarker section="project" />. The
 * /dashboard/project deep-link route stays valid and also clears the dot.
 */
export const SECTION_HREF: Record<NotifySection, string> = {
  project: "/dashboard",
  updates: "/dashboard/updates",
  reports: "/dashboard/reports",
  files: "/dashboard/files",
  invoices: "/dashboard/invoices",
};

export type ClientNotifications = Record<NotifySection, boolean>;

/**
 * Compute which portal sections have unseen activity for a client: the section
 * has a dot when its most recent activity is newer than the client's last view
 * of that section. `currentUserId` is excluded from "files" so a client's own
 * uploads never notify themselves (admin-side uploads still do).
 *
 * Runs entirely under the client's RLS — no service role needed.
 */
export async function getClientNotifications(
  clientId: string,
  currentUserId: string
): Promise<ClientNotifications> {
  const supabase = await createClient();

  const [stages, updates, reports, files, invoices, views] = await Promise.all([
    supabase
      .from("project_stages")
      .select("updated_at")
      .eq("client_id", clientId)
      .order("updated_at", { ascending: false })
      .limit(1),
    supabase
      .from("updates")
      .select("published_at")
      .eq("client_id", clientId)
      .order("published_at", { ascending: false })
      .limit(1),
    supabase
      .from("reports")
      .select("created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("files")
      .select("created_at, uploaded_by")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(20),
    // Latest client-visible invoice: `issued_at` is stamped when an invoice is
    // sent (drafts are excluded here AND by the client RLS policy).
    supabase
      .from("client_invoices")
      .select("issued_at")
      .eq("client_id", clientId)
      .neq("status", "draft")
      .not("issued_at", "is", null)
      .order("issued_at", { ascending: false })
      .limit(1),
    supabase
      .from("client_section_views")
      .select("section, last_viewed_at")
      .eq("client_id", clientId),
  ]);

  const viewedAt = new Map(
    (views.data ?? []).map((v) => [v.section, v.last_viewed_at])
  );

  const isUnread = (section: NotifySection, activityTs?: string | null) => {
    if (!activityTs) return false;
    const seen = viewedAt.get(section);
    return !seen || new Date(activityTs) > new Date(seen);
  };

  // Most recent file not uploaded by the current client user.
  const latestForeignFile = (files.data ?? []).find(
    (f) => f.uploaded_by !== currentUserId
  );

  return {
    project: isUnread("project", stages.data?.[0]?.updated_at),
    updates: isUnread("updates", updates.data?.[0]?.published_at),
    reports: isUnread("reports", reports.data?.[0]?.created_at),
    files: isUnread("files", latestForeignFile?.created_at),
    invoices: isUnread("invoices", invoices.data?.[0]?.issued_at),
  };
}

/** Open (unresolved) action-required items for a client, newest first. */
export async function getOpenActionItems(clientId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, title, body, link, created_at")
    .eq("client_id", clientId)
    .eq("action_required", true)
    .is("resolved_at", null)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function getClient(clientId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .single();
  return data;
}

export async function getClientServices(clientId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("client_services")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at");
  return data ?? [];
}

export async function getProjectStages(clientId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_stages")
    .select("*")
    .eq("client_id", clientId)
    .order("position");
  return data ?? [];
}

export async function getUpdates(clientId: string, limit?: number) {
  const supabase = await createClient();
  let query = supabase
    .from("updates")
    .select("*")
    .eq("client_id", clientId)
    .order("published_at", { ascending: false });
  if (limit) query = query.limit(limit);
  const { data } = await query;
  return data ?? [];
}

/**
 * Aggregate emoji reactions for a set of updates. RLS scopes rows to the caller
 * (a client sees reactions on their own updates; an admin sees all), so we just
 * count per emoji and flag the viewer's own choice.
 */
export async function getUpdateReactions(
  updateIds: string[],
  viewerProfileId?: string
): Promise<Record<string, ReactionSummary>> {
  const result: Record<string, ReactionSummary> = {};
  if (updateIds.length === 0) return result;

  const supabase = await createClient();
  const { data } = await supabase
    .from("update_reactions")
    .select("update_id, emoji, profile_id")
    .in("update_id", updateIds);

  for (const row of data ?? []) {
    const summary = (result[row.update_id] ??= { counts: {}, mine: null });
    summary.counts[row.emoji] = (summary.counts[row.emoji] ?? 0) + 1;
    if (viewerProfileId && row.profile_id === viewerProfileId) {
      summary.mine = row.emoji;
    }
  }
  return result;
}

export async function getReports(clientId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reports")
    .select("*")
    .eq("client_id", clientId)
    .order("reporting_month", { ascending: false });
  return data ?? [];
}

export async function getFiles(clientId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("files")
    .select("*")
    .eq("client_id", clientId)
    // Invoice PDFs live only in the Billing/Invoices surfaces — never the
    // generic Files manager (admin or client).
    .neq("asset_category", "invoices")
    .order("created_at", { ascending: false });
  return data ?? [];
}

/**
 * Client-facing activity timeline, newest first. RLS restricts a client session
 * to its own client-visible events; we filter + order explicitly too.
 */
export async function getActivityTimeline(clientId: string, limit = 30) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("activity_events")
    .select("id, type, title, description, icon, occurred_at")
    .eq("client_id", clientId)
    .eq("visibility", "client")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export interface ContractView {
  id: string;
  title: string;
  status: string;
  contract_url: string | null;
  signed_file_url: string | null;
  sent_at: string | null;
  signed_at: string | null;
  created_at: string;
  /** Linked signed file in the Files system, for download (if any). */
  signedFile: { name: string; path: string } | null;
}

/**
 * A client's contracts, newest first, each with its linked signed file (if any)
 * resolved for download. Works under both admin and client RLS.
 */
export async function getClientContracts(clientId: string): Promise<ContractView[]> {
  const supabase = await createClient();
  const { data: contracts } = await supabase
    .from("contracts")
    .select(
      "id, title, status, contract_url, signed_file_url, file_id, sent_at, signed_at, created_at"
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (!contracts || contracts.length === 0) return [];

  const fileIds = contracts
    .map((c) => c.file_id)
    .filter((id): id is string => Boolean(id));
  const fileMap = new Map<string, { name: string; path: string }>();
  if (fileIds.length > 0) {
    const { data: files } = await supabase
      .from("files")
      .select("id, name, path")
      .in("id", fileIds);
    for (const f of files ?? []) fileMap.set(f.id, { name: f.name, path: f.path });
  }

  return contracts.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    contract_url: c.contract_url,
    signed_file_url: c.signed_file_url,
    sent_at: c.sent_at,
    signed_at: c.signed_at,
    created_at: c.created_at,
    signedFile: c.file_id ? fileMap.get(c.file_id) ?? null : null,
  }));
}

/** Client-facing invoice. "Overdue" is derived (sent + past due), never stored. */
export interface ClientInvoiceView {
  id: string;
  invoice_number: string;
  title: string;
  amount: number;
  currency: string;
  status: string;
  /** "outstanding" | "overdue" | "paid" | "cancelled" — for the client badge. */
  clientStatus: "outstanding" | "overdue" | "paid" | "cancelled";
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  /** Linked invoice PDF in the Files system, for download (if any). */
  pdf: { name: string; path: string } | null;
}

/**
 * A client's own invoices for the portal Invoices page. RLS already restricts
 * this to the client's own, non-draft rows; we mirror that filter + ordering
 * and resolve the linked PDF for download. Read-only — clients never mutate.
 */
export async function getClientInvoices(
  clientId: string
): Promise<ClientInvoiceView[]> {
  const supabase = await createClient();
  const { data: invoices } = await supabase
    .from("client_invoices")
    .select(
      "id, invoice_number, title, amount, currency, status, issued_at, due_at, paid_at, file_id"
    )
    .eq("client_id", clientId)
    .neq("status", "draft")
    .order("issued_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (!invoices || invoices.length === 0) return [];

  const fileIds = invoices
    .map((i) => i.file_id)
    .filter((id): id is string => Boolean(id));
  const fileMap = new Map<string, { name: string; path: string }>();
  if (fileIds.length > 0) {
    const { data: files } = await supabase
      .from("files")
      .select("id, name, path")
      .in("id", fileIds);
    for (const f of files ?? []) fileMap.set(f.id, { name: f.name, path: f.path });
  }

  const now = Date.now();
  return invoices.map((i) => {
    const overdue =
      i.status === "sent" && i.due_at != null && new Date(i.due_at).getTime() < now;
    const clientStatus: ClientInvoiceView["clientStatus"] =
      i.status === "paid"
        ? "paid"
        : i.status === "void"
          ? "cancelled"
          : overdue
            ? "overdue"
            : "outstanding";
    return {
      id: i.id,
      invoice_number: i.invoice_number,
      title: i.title,
      amount: Number(i.amount),
      currency: i.currency,
      status: i.status,
      clientStatus,
      issued_at: i.issued_at,
      due_at: i.due_at,
      paid_at: i.paid_at,
      pdf: i.file_id ? fileMap.get(i.file_id) ?? null : null,
    };
  });
}

export async function getOnboarding(clientId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("onboarding_submissions")
    .select("*")
    .eq("client_id", clientId);
  return data ?? [];
}

/** Percentage of project stages completed (0–100). */
export function computeProgress(
  stages: { status: string }[]
): number {
  if (stages.length === 0) return 0;
  const done = stages.filter((s) => s.status === "completed").length;
  const inProgress = stages.filter((s) => s.status === "in_progress").length;
  return Math.round(((done + inProgress * 0.5) / stages.length) * 100);
}

/**
 * Onboarding is complete once every purchased service has been submitted or
 * approved. (Submitted is the terminal state in the client flow; approved is an
 * optional admin step.)
 */
export function isOnboardingComplete(
  services: { onboarding_status: string }[]
): boolean {
  return (
    services.length > 0 &&
    services.every(
      (s) =>
        s.onboarding_status === "submitted" ||
        s.onboarding_status === "approved"
    )
  );
}

/**
 * Derive the current project phase from the roadmap — the single source of
 * truth for "where the project is". Returns the in-progress stage if there is
 * one, otherwise the first pending stage, otherwise the last completed stage
 * (i.e. "Launched"). Used for the client hero so it never contradicts the
 * progress bar.
 */
export function currentPhase(
  stages: { name: string; status: string; position: number }[]
): { label: string; state: "completed" | "in_progress" | "pending" } | null {
  if (stages.length === 0) return null;
  const ordered = [...stages].sort((a, b) => a.position - b.position);

  const active = ordered.find((s) => s.status === "in_progress");
  if (active) return { label: active.name, state: "in_progress" };

  const pending = ordered.find((s) => s.status === "pending");
  if (pending) return { label: pending.name, state: "pending" };

  // Everything is complete.
  const last = ordered[ordered.length - 1];
  return { label: `${last.name} — Complete`, state: "completed" };
}

