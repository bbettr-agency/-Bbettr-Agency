import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isJarvisEnabled } from "@/lib/flags";
import { resolveJarvisContext } from "@/lib/jarvis/identity";
import { readRecentJarvisActions } from "@/lib/jarvis/audit";
import { CAPABILITY_REGISTRY } from "@/lib/jarvis/capabilities";
import { GRANT_JARVIS_APPROVE } from "@/lib/jarvis/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { JarvisConsole } from "@/components/admin/jarvis-console";

export const metadata: Metadata = { title: "Jarvis" };

export default async function JarvisPage() {
  await requireAdmin(); // V1 route gate: admin-only.

  if (!isJarvisEnabled()) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader title="Jarvis" description="Internal operational intelligence — Foundation 1 (security kernel)." />
        <Card>
          <CardContent className="p-6 text-sm text-ink-500">
            Jarvis is currently disabled (set <code>JARVIS_ENABLED=true</code> to reveal this surface). The security
            kernel is present but inert until enabled.
          </CardContent>
        </Card>
      </div>
    );
  }

  const ctx = await resolveJarvisContext();
  const enabled = !("denied" in ctx);
  const grants = enabled ? [...ctx.grants].sort() : [];
  const canApprove = enabled && ctx.grants.has(GRANT_JARVIS_APPROVE);

  const supabase = await createClient();
  const { data: proposals } = await supabase
    .from("jarvis_proposals")
    .select("id, capability_id, rationale, status, created_at, expires_at, initiated_by")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(25);
  const actions = await readRecentJarvisActions(30);

  const capabilities = Object.values(CAPABILITY_REGISTRY).map((c) => ({
    id: c.id,
    title: c.title,
    riskClass: c.riskClass,
    requiredGrant: c.requiredGrant,
  }));

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Jarvis" description="Internal operational intelligence — Foundation 1 (security kernel, no AI yet)." />

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Your Jarvis access</CardTitle>
          {enabled ? (
            <Badge tone="success" dot>Enabled</Badge>
          ) : (
            <Badge tone="warning" dot>Not enabled</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {enabled ? (
            <div className="flex flex-wrap gap-1.5">
              {grants.map((g) => (
                <span key={g} className="rounded-full border border-ink-200 bg-ink-50 px-2.5 py-0.5 text-xs font-medium text-ink-700">
                  {g}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-500">
              You are an admin but do not hold the <code>jarvis.use</code> grant yet. Assign yourself the{" "}
              <strong>founder</strong> bundle below to bootstrap access.
            </p>
          )}
        </CardContent>
      </Card>

      <JarvisConsole
        enabled={enabled}
        canApprove={canApprove}
        capabilities={capabilities}
        proposals={(proposals ?? []).map((p) => ({
          id: p.id as string,
          capabilityId: p.capability_id as string,
          rationale: (p.rationale as string | null) ?? null,
          createdAt: p.created_at as string,
          expiresAt: p.expires_at as string,
        }))}
        actions={actions}
      />
    </div>
  );
}
