import "server-only";

import { createClient } from "@/lib/supabase/server";
import { listMemories } from "./reads";
import {
  buildContextPackage,
  type ContextPackage,
  type PortalFact,
  type PortalSection,
  type MemorySummary,
} from "./context-shape";

/**
 * Jarvis Context Engine (server-only) — deterministic, READ-ONLY, bounded.
 *
 * Assembles authoritative Portal truth (read directly from Portal tables under
 * the caller's RLS — never duplicated into memory) + relevant durable memory
 * into a typed ContextPackage. NO writes, NO LLM, NO ranking beyond deterministic
 * importance/recency. Every section is explicitly capped.
 */

const CAPS = { services: 8, stages: 12, updates: 5, tasks: 10, clientMemory: 40, agencyMemory: 20 } as const;

function fact(key: string, label: string, value: unknown, source: string): PortalFact {
  return { key, label, value, source };
}

/**
 * Assemble bounded context for a client: authoritative Portal state + relevant
 * current memories (client-scoped + applicable agency rules), with open
 * commitments and unresolved conflicts surfaced separately.
 */
export async function assembleClientContext(clientId: string): Promise<ContextPackage | null> {
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, status")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return null;

  const [{ data: services }, { data: stages }, { data: updates }, { data: report }, { data: tasks }] =
    await Promise.all([
      supabase.from("client_services").select("service, onboarding_status, operational_status").eq("client_id", clientId).limit(CAPS.services),
      supabase.from("project_stages").select("name, status, position").eq("client_id", clientId).order("position", { ascending: true }).limit(CAPS.stages),
      supabase.from("updates").select("title, published_at").eq("client_id", clientId).order("published_at", { ascending: false }).limit(CAPS.updates),
      supabase.from("reports").select("reporting_month, summary").eq("client_id", clientId).order("reporting_month", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("tasks").select("title, status").eq("client_id", clientId).not("status", "in", "(completed,archived)").limit(CAPS.tasks),
    ]);

  const sections: PortalSection[] = [
    {
      title: "Client",
      facts: [
        fact("name", "Name", client.name, "clients.name"),
        fact("status", "Status", client.status, "clients.status"),
      ],
    },
    {
      title: "Services",
      facts: (services ?? []).map((s) =>
        fact(`service:${s.service}`, s.service, { onboarding: s.onboarding_status, operational: s.operational_status ?? null }, "client_services")
      ),
    },
    {
      title: "Project stages",
      facts: (stages ?? []).map((s, i) => fact(`stage:${i}`, s.name, s.status, "project_stages")),
    },
    {
      title: "Recent updates",
      facts: (updates ?? []).map((u, i) => fact(`update:${i}`, u.title, u.published_at, "updates")),
    },
    {
      title: "Latest report",
      facts: report ? [fact("report", report.reporting_month, report.summary ?? null, "reports")] : [],
    },
    {
      title: "Open tasks",
      facts: (tasks ?? []).map((t, i) => fact(`task:${i}`, t.title, t.status, "tasks")),
    },
  ];

  const [clientMem, agencyMem] = await Promise.all([
    listMemories({ scope: "client", clientId, currentOnly: true, limit: CAPS.clientMemory }),
    listMemories({ scope: "agency", currentOnly: true, limit: CAPS.agencyMemory }),
  ]);
  const memories: MemorySummary[] = [...clientMem, ...agencyMem];

  return buildContextPackage({
    kind: "client",
    subjectId: clientId,
    generatedAt: new Date().toISOString(),
    portalSections: sections,
    memories,
  });
}

/** Assemble agency-wide context: minimal Portal signal + agency-scoped memory. */
export async function assembleAgencyContext(): Promise<ContextPackage> {
  const supabase = await createClient();
  const { count: clientCount } = await supabase.from("clients").select("id", { count: "exact", head: true });

  const sections: PortalSection[] = [
    { title: "Agency", facts: [fact("clients", "Clients", clientCount ?? 0, "clients")] },
  ];
  const memories = await listMemories({ scope: "agency", currentOnly: true, limit: 50 });
  return buildContextPackage({
    kind: "agency",
    subjectId: null,
    generatedAt: new Date().toISOString(),
    portalSections: sections,
    memories,
  });
}

/** Assemble one internal user's personal context (user-scoped memory only). */
export async function assembleUserContext(userId: string): Promise<ContextPackage> {
  const memories = await listMemories({ scope: "user", userId, currentOnly: true, limit: 50 });
  return buildContextPackage({
    kind: "user",
    subjectId: userId,
    generatedAt: new Date().toISOString(),
    portalSections: [],
    memories,
  });
}
