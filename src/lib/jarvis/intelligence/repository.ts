import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/database.types";
import type { JarvisContext } from "@/lib/jarvis/identity";
import type { LLMMessage } from "@/lib/jarvis/llm/provider";
import type { ValidatedProposedIntent, ValidatedUncertainty, TrustedProvenance } from "./types";

/**
 * Jarvis Intelligence — conversation storage boundary (Slice C, server-only).
 *
 * The ONLY place Intelligence writes conversation rows. Writes go through the
 * service role (RLS blocks authenticated writes; messages are append-only). Owner
 * + workspace are always taken from the trusted JarvisContext — never from model
 * output or the browser. There is deliberately no generic write helper.
 */
export const SAFE_FAILURE_MESSAGE = "I couldn't complete that request right now. Please try again.";

export interface ConversationThread {
  id: string;
  lastClientId: string | null;
}

export interface AssistantRow {
  status: "ok" | "error";
  content: string;
  reasoningSummary?: string;
  uncertainty?: ValidatedUncertainty;
  proposedIntent?: ValidatedProposedIntent;
  provider?: string | null;
  model?: string | null;
  usage?: unknown;
  provenance?: TrustedProvenance | Record<string, unknown>;
}

export interface ConversationRepo {
  createThread(ctx: JarvisContext): Promise<ConversationThread>;
  loadAuthorizedThread(ctx: JarvisContext, threadId: string): Promise<ConversationThread | null>;
  /** Returns the inserted message id (used by the F1b turn ledger for set-once linkage). */
  persistUserMessage(ctx: JarvisContext, threadId: string, content: string, requestId: string): Promise<string>;
  loadBoundedHistory(ctx: JarvisContext, threadId: string, limitMessages: number): Promise<LLMMessage[]>;
  updateLastClientId(ctx: JarvisContext, threadId: string, clientId: string): Promise<void>;
  /** Returns the inserted assistant message id (used by the F1b turn ledger for set-once linkage). */
  persistAssistant(ctx: JarvisContext, threadId: string, requestId: string, row: AssistantRow): Promise<string>;
}

const J = (v: unknown): Json | null => (v === undefined || v === null ? null : (v as unknown as Json));

export function createConversationRepo(): ConversationRepo {
  return {
    async createThread(ctx) {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("jarvis_threads")
        .insert({ workspace_id: ctx.workspaceId, user_id: ctx.principalId })
        .select("id, last_client_id")
        .single();
      if (error || !data) throw new Error("jarvis: could not create thread");
      return { id: data.id as string, lastClientId: (data.last_client_id as string | null) ?? null };
    },

    async loadAuthorizedThread(ctx, threadId) {
      const admin = createAdminClient();
      const { data } = await admin
        .from("jarvis_threads")
        .select("id, last_client_id")
        .eq("id", threadId)
        .eq("workspace_id", ctx.workspaceId)
        .eq("user_id", ctx.principalId) // trusted ownership check
        .maybeSingle();
      return data ? { id: data.id as string, lastClientId: (data.last_client_id as string | null) ?? null } : null;
    },

    async persistUserMessage(ctx, threadId, content, requestId) {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("jarvis_messages")
        .insert({
          thread_id: threadId,
          workspace_id: ctx.workspaceId,
          role: "user",
          content,
          status: "ok",
          request_id: requestId,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error("jarvis: could not persist user message");
      return data.id as string;
    },

    async loadBoundedHistory(ctx, threadId, limitMessages) {
      const admin = createAdminClient();
      // Defense-in-depth (F-03): this service-role read bypasses RLS, so the read
      // boundary itself must enforce OWNERSHIP before returning any transcript.
      // `jarvis_messages` has no user_id column — ownership lives on the parent
      // thread — so we first require the owning thread to match ALL THREE trusted
      // dimensions (id + workspace_id + user_id), sourced only from the trusted
      // JarvisContext (never model/browser/content). Any mismatch ⇒ fail closed
      // ([], and the message query is NEVER executed). These are the SAME three
      // predicates loadAuthorizedThread uses (kept identical, intentionally); an
      // explicit owner check is used here rather than reusing that method because
      // it returns thread ROW DATA (last_client_id) for referent resolution, not a
      // boolean gate — reusing it would either require a redundant read or broaden
      // its responsibility. The message query below is otherwise UNCHANGED.
      const { data: owned } = await admin
        .from("jarvis_threads")
        .select("id")
        .eq("id", threadId)
        .eq("workspace_id", ctx.workspaceId) // trusted workspace
        .eq("user_id", ctx.principalId) // trusted principal (owner)
        .maybeSingle();
      if (!owned) return [];

      const { data } = await admin
        .from("jarvis_messages")
        .select("role, content, seq")
        .eq("thread_id", threadId)
        .eq("workspace_id", ctx.workspaceId)
        .eq("status", "ok") // exclude prior failure rows from model history
        .order("seq", { ascending: false })
        .limit(Math.max(1, limitMessages));
      const rows = (data ?? []).slice().reverse(); // chronological
      return rows.map((r) => ({ role: r.role as LLMMessage["role"], content: r.content as string }));
    },

    async updateLastClientId(ctx, threadId, clientId) {
      const admin = createAdminClient();
      await admin
        .from("jarvis_threads")
        .update({ last_client_id: clientId, updated_at: new Date().toISOString() })
        .eq("id", threadId)
        .eq("workspace_id", ctx.workspaceId)
        .eq("user_id", ctx.principalId);
    },

    async persistAssistant(ctx, threadId, requestId, row) {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("jarvis_messages")
        .insert({
          thread_id: threadId,
          workspace_id: ctx.workspaceId,
          role: "assistant",
          content: row.content,
          status: row.status,
          request_id: requestId,
          reasoning_summary: row.reasoningSummary ?? null,
          uncertainty: J(row.uncertainty),
          proposed_intent: J(row.proposedIntent),
          provider: row.provider ?? null,
          model: row.model ?? null,
          usage: J(row.usage),
          provenance: J(row.provenance),
        })
        .select("id")
        .single();
      if (error || !data) throw new Error("jarvis: could not persist assistant message");
      return data.id as string;
    },
  };
}
