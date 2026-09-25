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
  persistUserMessage(ctx: JarvisContext, threadId: string, content: string, requestId: string): Promise<void>;
  loadBoundedHistory(ctx: JarvisContext, threadId: string, limitMessages: number): Promise<LLMMessage[]>;
  updateLastClientId(ctx: JarvisContext, threadId: string, clientId: string): Promise<void>;
  persistAssistant(ctx: JarvisContext, threadId: string, requestId: string, row: AssistantRow): Promise<void>;
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
      const { error } = await admin.from("jarvis_messages").insert({
        thread_id: threadId,
        workspace_id: ctx.workspaceId,
        role: "user",
        content,
        status: "ok",
        request_id: requestId,
      });
      if (error) throw new Error("jarvis: could not persist user message");
    },

    async loadBoundedHistory(ctx, threadId, limitMessages) {
      const admin = createAdminClient();
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
      const { error } = await admin.from("jarvis_messages").insert({
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
      });
      if (error) throw new Error("jarvis: could not persist assistant message");
    },
  };
}
