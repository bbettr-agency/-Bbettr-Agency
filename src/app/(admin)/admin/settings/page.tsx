import type { Metadata } from "next";
import { Palette, ShieldCheck, Database, Building2, Wrench } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getPortalSettings } from "@/lib/settings";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MaintenanceToggle } from "@/components/admin/maintenance-toggle";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const profile = await requireAdmin();
  const settings = await getPortalSettings();

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Settings"
        description="Workspace configuration and platform details."
      />

      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <Wrench className="h-4.5 w-4.5 text-brand-500" />
          <CardTitle>Maintenance</CardTitle>
        </CardHeader>
        <CardContent>
          <MaintenanceToggle initialOn={settings.maintenanceMode} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <Building2 className="h-4.5 w-4.5 text-brand-500" />
            <CardTitle>Workspace</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Agency" value="Bbettr Agency" />
            <Row label="Portal domain" value="portal.bbettragency.com" />
            <Row label="Signed in as" value={profile.email ?? "—"} />
            <Row label="Role" value="Administrator" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <Palette className="h-4.5 w-4.5 text-brand-500" />
            <CardTitle>Brand</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-ink-500">Primary colour</span>
              <span className="flex items-center gap-2">
                <span className="h-5 w-5 rounded-md bg-brand-500 ring-1 ring-inset ring-black/10" />
                <code className="font-mono text-ink-800">#38B6FF</code>
              </span>
            </div>
            <Row label="Typography" value="Inter · Sora" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <ShieldCheck className="h-4.5 w-4.5 text-brand-500" />
            <CardTitle>Security & Multi-tenancy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-ink-600">
            <p>
              Tenant isolation is enforced at the database layer with PostgreSQL
              Row-Level Security. Each client can only access rows scoped to
              their own tenant; admins have full visibility.
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge tone="success" dot>
                RLS enabled
              </Badge>
              <Badge tone="success" dot>
                Storage scoped per tenant
              </Badge>
              <Badge tone="info" dot>
                Supabase Auth
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <Database className="h-4.5 w-4.5 text-brand-500" />
            <CardTitle>Platform</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Framework" value="Next.js (App Router)" />
            <Row label="Database" value="Supabase Postgres" />
            <Row label="Storage" value="Supabase Storage" />
            <Row label="Deployment" value="Vercel" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-500">{label}</span>
      <span className="font-medium text-ink-900">{value}</span>
    </div>
  );
}
