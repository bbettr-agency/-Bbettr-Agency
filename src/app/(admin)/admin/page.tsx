import type { Metadata } from "next";
import Link from "next/link";
import { format } from "date-fns";
import {
  Users,
  Briefcase,
  ClipboardList,
  BarChart3,
  FolderOpen,
  Megaphone,
  ArrowRight,
  Plus,
} from "lucide-react";
import { getAdminStats, getAllClients, getRecentUpdatesGlobal } from "@/lib/admin-queries";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { ClientStatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Admin Overview" };

export default async function AdminOverviewPage() {
  const [stats, clients, updates] = await Promise.all([
    getAdminStats(),
    getAllClients(),
    getRecentUpdatesGlobal(5),
  ]);

  const recentClients = clients.slice(0, 5);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Agency Overview"
        description="Everything happening across all Bbettr Agency clients."
        actions={
          <Button asChild>
            <Link href="/admin/clients/new">
              <Plus className="h-4 w-4" /> New client
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total Clients" value={stats.totalClients} icon={Users} />
        <StatCard label="Active Projects" value={stats.activeProjects} icon={Briefcase} />
        <StatCard
          label="Pending Onboarding"
          value={stats.pendingOnboardings}
          icon={ClipboardList}
        />
        <StatCard label="Reports" value={stats.totalReports} icon={BarChart3} />
        <StatCard label="Updates" value={stats.recentUpdates} icon={Megaphone} />
        <StatCard label="Files" value={stats.totalFiles} icon={FolderOpen} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent clients */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent Clients</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/clients">
                View all <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recentClients.length > 0 ? (
              <ul className="divide-y divide-ink-100">
                {recentClients.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/admin/clients/${c.id}`}
                      className="flex items-center gap-3 py-3 transition-colors hover:bg-ink-50/60"
                    >
                      <Avatar name={c.name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink-900">
                          {c.name}
                        </p>
                        <p className="truncate text-xs text-ink-400">
                          {c.contact_name ?? c.contact_email ?? "—"}
                        </p>
                      </div>
                      <ClientStatusBadge status={c.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={Users}
                title="No clients yet"
                description="Create your first client to get started."
                action={
                  <Button asChild>
                    <Link href="/admin/clients/new">
                      <Plus className="h-4 w-4" /> New client
                    </Link>
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>

        {/* Recent updates */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Updates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {updates.length > 0 ? (
              updates.map((u) => {
                const clientName =
                  (u.clients as { name: string } | null)?.name ?? "Client";
                return (
                  <div
                    key={u.id}
                    className="rounded-xl border border-ink-100 p-3"
                  >
                    <p className="text-xs text-ink-400">
                      {clientName} · {format(new Date(u.published_at), "d MMM")}
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-ink-900">
                      {u.title}
                    </p>
                  </div>
                );
              })
            ) : (
              <p className="py-6 text-center text-sm text-ink-400">
                No updates posted yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
