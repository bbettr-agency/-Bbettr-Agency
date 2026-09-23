"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { resolveJarvisContext } from "@/lib/jarvis/identity";
import { GRANT_JARVIS_APPROVE, GRANT_MEMORY_PROPOSE, GRANT_MEMORY_READ } from "@/lib/jarvis/constants";
import { createMemory, confirmMemory, retireMemory, supersedeMemory, flagConflict, type MemoryActor, type MemoryCreateInput } from "@/lib/jarvis/memory/store";
import { assembleClientContext } from "@/lib/jarvis/memory/context-engine";
import {
  isMemoryScope,
  isMemoryCategory,
  isMemorySourceKind,
} from "@/lib/jarvis/memory/types";

export interface MemoryActionResult {
  ok: boolean;
  error?: string;
  detail?: string;
}

async function resolveActor(): Promise<{ actor: MemoryActor; grants: Set<string> } | { error: string }> {
  const profile = await requireAdmin();
  const ctx = await resolveJarvisContext();
  if ("denied" in ctx) return { error: `Jarvis not enabled: ${ctx.denied}` };
  const display = profile.full_name?.trim() || profile.email?.trim() || profile.id;
  return {
    actor: {
      principalId: ctx.principalId,
      workspaceId: ctx.workspaceId,
      display,
      hasApproveAuthority: ctx.grants.has(GRANT_JARVIS_APPROVE),
    },
    grants: ctx.grants,
  };
}

function buildCreateInput(form: FormData): MemoryCreateInput | { error: string } {
  const scope = String(form.get("scope") ?? "");
  const category = String(form.get("category") ?? "");
  const sourceKind = String(form.get("sourceKind") ?? "human_statement");
  const claim = String(form.get("claim") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  const clientId = String(form.get("clientId") ?? "").trim();
  const userId = String(form.get("userId") ?? "").trim();
  const declaredSecret = form.get("declaredSecret") === "on";

  if (!isMemoryScope(scope)) return { error: "Invalid scope." };
  if (!isMemoryCategory(category)) return { error: "Invalid category." };
  if (!isMemorySourceKind(sourceKind)) return { error: "Invalid source kind." };
  if (!claim) return { error: "Claim is required." };

  return {
    scope,
    category,
    sourceKind,
    claim,
    body: body || null,
    clientId: scope === "client" ? clientId || null : null,
    userId: scope === "user" ? userId || null : null,
    declaredSecret,
  };
}

export async function proposeMemoryAction(form: FormData): Promise<MemoryActionResult> {
  const r = await resolveActor();
  if ("error" in r) return { ok: false, error: r.error };
  if (!r.grants.has(GRANT_MEMORY_PROPOSE)) return { ok: false, error: "You lack memory.propose." };

  const input = buildCreateInput(form);
  if ("error" in input) return { ok: false, error: input.error };

  const res = await createMemory(r.actor, input);
  revalidatePath("/admin/jarvis");
  if (!res.ok) {
    const cats = res.secretCategories?.length ? ` [${res.secretCategories.join(", ")}]` : "";
    return { ok: false, error: `Rejected: ${res.reason}${cats}` };
  }
  return { ok: true, detail: `Stored memory ${res.id} as '${res.state}'.` };
}

export async function confirmMemoryAction(memoryId: string): Promise<MemoryActionResult> {
  const r = await resolveActor();
  if ("error" in r) return { ok: false, error: r.error };
  if (!r.actor.hasApproveAuthority) return { ok: false, error: "You lack jarvis.approve authority." };
  const res = await confirmMemory(r.actor, memoryId);
  revalidatePath("/admin/jarvis");
  return res.ok ? { ok: true, detail: "Confirmed." } : { ok: false, error: res.reason };
}

export async function retireMemoryAction(memoryId: string, reason: string): Promise<MemoryActionResult> {
  const r = await resolveActor();
  if ("error" in r) return { ok: false, error: r.error };
  if (!r.actor.hasApproveAuthority) return { ok: false, error: "You lack jarvis.approve authority." };
  const res = await retireMemory(r.actor, memoryId, reason || "retired via admin surface");
  revalidatePath("/admin/jarvis");
  return res.ok ? { ok: true, detail: "Retired." } : { ok: false, error: res.reason };
}

export async function supersedeMemoryAction(oldId: string, form: FormData): Promise<MemoryActionResult> {
  const r = await resolveActor();
  if ("error" in r) return { ok: false, error: r.error };
  if (!r.actor.hasApproveAuthority) return { ok: false, error: "You lack jarvis.approve authority." };
  const input = buildCreateInput(form);
  if ("error" in input) return { ok: false, error: input.error };
  const reason = String(form.get("reason") ?? "correction").trim() || "correction";
  const res = await supersedeMemory(r.actor, oldId, input, reason);
  revalidatePath("/admin/jarvis");
  if (!res.ok) {
    const cats = res.secretCategories?.length ? ` [${res.secretCategories.join(", ")}]` : "";
    return { ok: false, error: `${res.reason}${cats}` };
  }
  return { ok: true, detail: `Superseded — new memory ${res.id}.` };
}

export async function flagConflictAction(aId: string, bId: string, reason: string): Promise<MemoryActionResult> {
  const r = await resolveActor();
  if ("error" in r) return { ok: false, error: r.error };
  if (!r.grants.has(GRANT_MEMORY_PROPOSE)) return { ok: false, error: "You lack memory.propose." };
  const res = await flagConflict(r.actor, aId, bId, reason || "flagged via admin surface");
  revalidatePath("/admin/jarvis");
  return res.ok ? { ok: true, detail: "Conflict flagged." } : { ok: false, error: res.reason };
}

export async function previewClientContextAction(clientId: string): Promise<MemoryActionResult> {
  const r = await resolveActor();
  if ("error" in r) return { ok: false, error: r.error };
  if (!r.grants.has(GRANT_MEMORY_READ)) return { ok: false, error: "You lack memory.read." };
  if (!clientId.trim()) return { ok: false, error: "Client id required." };
  const pkg = await assembleClientContext(clientId.trim());
  if (!pkg) return { ok: false, error: "Client not found." };
  return { ok: true, detail: JSON.stringify(pkg, null, 2) };
}
