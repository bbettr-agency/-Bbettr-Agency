"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail, isValidEmail } from "@/lib/portal-access";
import { requireJarvisUser } from "@/lib/jarvis/identity";
import { invokeCapability } from "@/lib/jarvis/dispatch";
import { approveAndExecuteProposal, rejectProposal } from "@/lib/jarvis/proposals";
import { appendJarvisAction } from "@/lib/jarvis/audit";
import { isAssignableGrantKey } from "@/lib/jarvis/bundles";

export interface JarvisActionResult {
  ok: boolean;
  error?: string;
  detail?: string;
}

/**
 * BOOTSTRAP / grant management (Foundation 1). Admin-only (V1 route gate). Grants
 * a whitelisted bundle/capability key to a profile resolved by email, via the
 * service role, and audits it. This is how Eloff/Ashwin receive the founder
 * bundle as DATA (never hardcoded by email in code). Documented as the
 * post-migration bootstrap step. Future staff grant-management should move
 * behind a dedicated Jarvis capability; kept admin-gated for V1.
 */
export async function assignJarvisGrantAction(rawEmail: string, grantKey: string): Promise<JarvisActionResult> {
  const admin = await requireAdmin();
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return { ok: false, error: "Enter a valid email address." };
  if (!isAssignableGrantKey(grantKey)) return { ok: false, error: "Unknown grant key." };

  const supabase = await createClient();
  const { data: ws } = await supabase.rpc("current_workspace_id");
  const workspaceId = (ws as string | null) ?? null;
  if (!workspaceId) return { ok: false, error: "Agency workspace could not be resolved." };

  const svc = createAdminClient();
  const { data: target } = await svc.from("profiles").select("id, role").eq("email", email).maybeSingle();
  if (!target) return { ok: false, error: "No portal profile exists for that email." };

  const { error } = await svc
    .from("jarvis_capability_grants")
    .upsert(
      { workspace_id: workspaceId, subject_user_id: target.id, grant_key: grantKey, granted_by: admin.id },
      { onConflict: "workspace_id,subject_user_id,grant_key", ignoreDuplicates: true }
    );
  if (error) return { ok: false, error: "Could not assign the grant." };

  await appendJarvisAction({
    workspaceId,
    actorKind: "human",
    initiatedBy: admin.id,
    capabilityId: "jarvis.grant.assign",
    decision: "allow",
    executed: true,
    success: true,
    detail: { subject: target.id, grantKey },
  });
  revalidatePath("/admin/jarvis");
  return { ok: true, detail: `Granted ${grantKey} to ${email}.` };
}

/** Approve + execute a pending proposal (requires jarvis.approve). */
export async function approveProposalAction(proposalId: string): Promise<JarvisActionResult> {
  const ctx = await requireJarvisUser();
  const res = await approveAndExecuteProposal(ctx, proposalId);
  revalidatePath("/admin/jarvis");
  return res.ok ? { ok: true, detail: "Approved and executed." } : { ok: false, error: res.reason };
}

/** Reject a pending proposal (requires jarvis.approve). */
export async function rejectProposalAction(proposalId: string): Promise<JarvisActionResult> {
  const ctx = await requireJarvisUser();
  const res = await rejectProposal(ctx, proposalId);
  revalidatePath("/admin/jarvis");
  return res.ok ? { ok: true, detail: "Rejected." } : { ok: false, error: res.error };
}

/** Invoke a capability (Foundation 1 test surface) — full policy path applies. */
export async function invokeCapabilityAction(capabilityId: string, argsJson: string): Promise<JarvisActionResult> {
  const ctx = await requireJarvisUser();
  let args: unknown = {};
  if (argsJson.trim()) {
    try {
      args = JSON.parse(argsJson);
    } catch {
      return { ok: false, error: "Arguments must be valid JSON." };
    }
  }
  const res = await invokeCapability(ctx, capabilityId, args);
  revalidatePath("/admin/jarvis");
  if (res.status === "deny") return { ok: false, error: `Denied: ${res.reason}` };
  if (res.status === "error") return { ok: false, error: `Error: ${res.reason}` };
  if (res.status === "needs_approval") return { ok: true, detail: `Proposal created (pending approval): ${res.proposalId}` };
  return { ok: true, detail: `${res.status}: ${JSON.stringify(res.result)}` };
}
